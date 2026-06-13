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

  try {
    return await Promise.race([guardedOperation, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
