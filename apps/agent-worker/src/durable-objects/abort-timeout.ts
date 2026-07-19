export type AbortTimeoutResult<T> = T | "timeout";

interface AbortTimeoutInput<T> {
  abortController: AbortController;
  operation: Promise<T>;
  timeoutMs: number;
}

export async function resolveWithAbortTimeout<T>({
  abortController,
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
    timeoutId = setTimeout(() => {
      abortController.abort(new Error("operation timed out"));
      resolve("timeout");
    }, timeoutMs);
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
