"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Seconds elapsed since `active` became true, ticking once per second; resets to 0
 * whenever `active` flips to false. Used for the run "Working • Ns" indicator.
 */
export function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<null | number>(null);

  useEffect(() => {
    if (!active) {
      startRef.current = null;
      setElapsed(0);
      return;
    }
    startRef.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      if (startRef.current !== null) {
        setElapsed(Math.max(0, Math.floor((Date.now() - startRef.current) / 1000)));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  return elapsed;
}
