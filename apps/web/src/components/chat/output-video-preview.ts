"use client";

import { useEffect, useRef, useState } from "react";
import {
  type OutputPreviewIdentity,
  type OutputPreviewState,
  useNearViewport,
} from "@/components/chat/output-preview-support";
import { createOutputDownloadUrl } from "@/lib/api/outputs";

export function useLazyOutputVideoPreview(
  data: OutputPreviewIdentity,
  getToken: () => Promise<null | string>,
): OutputPreviewState {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const getTokenRef = useRef(getToken);
  const isNearViewport = useNearViewport(hostRef);
  const [preview, setPreview] = useState<Omit<OutputPreviewState, "hostRef">>({
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
    setPreview({ message: null, status: "loading", url: null });
    void createOutputDownloadUrl(() => getTokenRef.current(), data.outputId, controller.signal)
      .then((capability) => {
        setPreview({ message: null, status: "ready", url: capability.downloadUrl });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPreview({
          message: error instanceof Error ? error.message : "Preview unavailable",
          status: "error",
          url: null,
        });
      });
    return () => controller.abort();
  }, [data.outputId, isNearViewport]);

  return { ...preview, hostRef };
}
