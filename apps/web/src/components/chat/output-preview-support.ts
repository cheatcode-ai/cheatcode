"use client";

import { type RefObject, useEffect, useState } from "react";

export interface OutputPreviewIdentity {
  outputId: string;
  sizeBytes: number;
}

export interface OutputPreviewState {
  hostRef: RefObject<HTMLDivElement | null>;
  message: string | null;
  status: "error" | "idle" | "loading" | "ready";
  url: string | null;
}

export function useNearViewport(ref: RefObject<HTMLElement | null>): boolean {
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
