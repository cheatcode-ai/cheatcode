import type { DatabaseHandle } from "@cheatcode/db";
import type { createLogger } from "@cheatcode/observability";

const DEFAULT_DB_CLOSE_TIMEOUT_MS = 1_000;

export async function closeDatabaseBestEffort(input: {
  dbHandle: DatabaseHandle;
  logger: ReturnType<typeof createLogger>;
  operation: string;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_DB_CLOSE_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const close = input.dbHandle
    .close()
    .then(() => "closed" as const)
    .catch((error: unknown) => {
      input.logger.warn("db_close_failed", {
        error,
        operation: input.operation,
      });
      return "closed" as const;
    });
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  const result = await Promise.race([close, timeout]);
  if (result === "closed" && timeoutId) {
    clearTimeout(timeoutId);
    return;
  }
  input.logger.warn("db_close_timeout", {
    operation: input.operation,
    timeoutMs,
  });
}
