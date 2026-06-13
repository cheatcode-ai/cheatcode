import type { Logger } from "./logger";

export async function span<T>(
  logger: Logger,
  name: string,
  attrs: Record<string, string | number>,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await fn();
    logger.info(`span.${name}`, {
      span: name,
      duration_ms: performance.now() - startedAt,
      status: "ok",
      ...attrs,
    });
    return result;
  } catch (error) {
    logger.error(`span.${name}.failed`, {
      span: name,
      duration_ms: performance.now() - startedAt,
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
      ...attrs,
    });
    throw error;
  }
}
