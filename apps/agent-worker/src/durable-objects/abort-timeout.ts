export type AbortTimeoutResult<T> = T | "timeout";

interface AbortTimeoutInput<T> {
  abortController: AbortController;
  /**
   * Pending-decision interlock. Consulted at timer-fire time (run-control
   * §5.1/§5.4): when it returns `true` (a user approval decision is pending),
   * the deadline is re-armed WITHOUT aborting and WITHOUT resolving, so the
   * same in-flight `operation` promise keeps being awaited (no second
   * `iterator.next()` is ever issued and the Mastra stream is never torn down
   * mid-pause). Only when it returns `false` does the timer abort + resolve
   * `"timeout"`.
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
  const guardedOperation = operation.catch((error: unknown) => {
    if (abortController.signal.aborted) {
      return "timeout" as const;
    }
    throw error;
  });
  const timeout = new Promise<"timeout">((resolve) => {
    const fire = () => {
      if (extendWhile?.()) {
        timeoutId = setTimeout(fire, Math.max(timeoutMs, 1_000));
        return;
      }
      abortController.abort(new Error("operation timed out"));
      resolve("timeout");
    };
    timeoutId = setTimeout(fire, timeoutMs);
  });

  try {
    return await Promise.race([guardedOperation, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
