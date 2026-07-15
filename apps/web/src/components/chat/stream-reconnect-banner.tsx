"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";

const AUTO_CLEAR_MS = 6_000;

/**
 * Client-only reconnect notice. Renders when the transport's
 * `prepareReconnectToStreamRequest` recorded a non-zero resume cursor; auto-
 * clears after ~6 s and on unmount/thread change (ChatPanel remounts per
 * thread, so the unmount cleanup prevents a stale notice leaking across).
 */
export function StreamReconnectBanner() {
  const streamReconnect = useAppStore((state) => state.streamReconnect);
  const setStreamReconnect = useAppStore((state) => state.setStreamReconnect);

  useEffect(() => {
    if (streamReconnect === null) {
      return;
    }
    const timer = window.setTimeout(() => setStreamReconnect(null), AUTO_CLEAR_MS);
    return () => window.clearTimeout(timer);
  }, [setStreamReconnect, streamReconnect]);

  useEffect(() => () => setStreamReconnect(null), [setStreamReconnect]);

  if (streamReconnect === null) {
    return null;
  }

  return (
    <div
      className="border-thread-border-subtle border-b bg-[var(--thread-code-bg)] px-4 py-2 font-mono text-[10px] text-thread-text-secondary uppercase tracking-[0.2em]"
      role="status"
    >
      Stream reconnected — replaying from seq {streamReconnect.fromSeq}
    </div>
  );
}
