export type AbortTimeoutResult<T> = T | "timeout";

interface AbortTimeoutInput<T> {
  abortController: AbortController;
  /**
   * Pending-decision interlock. While approval is pending, the same operation
   * remains in flight and the timer polls without issuing a second read.
   */
  extendWhile?: () => boolean;
  operation: Promise<T>;
  timeoutMs: number;
}

export async function resolveWithAbortTimeout<T>({
  abortController,
  extendWhile,
  operation,
  timeoutMs,
}: AbortTimeoutInput<T>): Promise<AbortTimeoutResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let resolveAbort: ((value: "timeout") => void) | undefined;
  const guardedOperation = operation.catch((error: unknown) => {
    if (abortController.signal.aborted) {
      return "timeout" as const;
    }
    throw error;
  });
  const timeout = new Promise<"timeout">((resolve) => {
    const fire = () => {
      if (extendWhile?.()) {
        timeoutId = setTimeout(fire, 1_000);
        return;
      }
      abortController.abort(new Error("operation timed out"));
      resolve("timeout");
    };
    timeoutId = setTimeout(fire, timeoutMs);
  });
  const aborted = new Promise<"timeout">((resolve) => {
    resolveAbort = resolve;
    if (abortController.signal.aborted) {
      resolve("timeout");
      return;
    }
    abortController.signal.addEventListener("abort", resolveAbortSignal, { once: true });
  });
  function resolveAbortSignal(): void {
    resolveAbort?.("timeout");
  }

  try {
    return await Promise.race([guardedOperation, timeout, aborted]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    abortController.signal.removeEventListener("abort", resolveAbortSignal);
  }
}
