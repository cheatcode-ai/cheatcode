"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { loadOutputImagePreview } from "@/lib/api/outputs";

export interface OutputImagePreviewState {
  hostRef: RefObject<HTMLDivElement | null>;
  message: string | null;
  status: "error" | "idle" | "loading" | "ready";
  url: string | null;
}

interface OutputImageIdentity {
  outputId: string;
  sizeBytes: number;
}

export function useLazyOutputImagePreview(
  data: OutputImageIdentity,
  getToken: () => Promise<null | string>,
): OutputImagePreviewState {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const getTokenRef = useRef(getToken);
  const isNearViewport = useNearViewport(hostRef);
  const [preview, setPreview] = useState<Omit<OutputImagePreviewState, "hostRef">>({
    message: null,
    status: "idle",
    url: null,
  });

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!isNearViewport) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setPreview({ message: null, status: "loading", url: null });
    void loadOutputImagePreview(
      () => getTokenRef.current(),
      data.outputId,
      data.sizeBytes,
      controller.signal,
    )
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setPreview({ message: null, status: "ready", url: objectUrl });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPreview({
          message: error instanceof Error ? error.message : "Preview unavailable",
          status: "error",
          url: null,
        });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data.outputId, data.sizeBytes, isNearViewport]);

  return { ...preview, hostRef };
}

function useNearViewport(ref: RefObject<HTMLElement | null>): boolean {
  const [isNear, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: "320px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return isNear;
}
