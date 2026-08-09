"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Seconds elapsed since the run began, ticking once per second. A stable start
 * timestamp keeps the timer continuous while optimistic UI becomes streamed UI.
 */
export function useElapsedSeconds(active: boolean, startedAt: null | number = null): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<null | number>(null);

  useEffect(() => {
    if (!active) {
      startRef.current = null;
      setElapsed(0);
      return;
    }
    startRef.current = startedAt ?? Date.now();
    setElapsed(Math.max(0, Math.floor((Date.now() - startRef.current) / 1000)));
    const id = setInterval(() => {
      if (startRef.current !== null) {
        setElapsed(Math.max(0, Math.floor((Date.now() - startRef.current) / 1000)));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);

  return elapsed;
}
