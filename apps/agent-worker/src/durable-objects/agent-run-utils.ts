import { APIError } from "@cheatcode/observability";
import { resolveWithAbortTimeout } from "./abort-timeout";

export type MastraChunkRead = IteratorResult<unknown, unknown> | "timeout";

export function missingInternalUserResponse(
  surface: "approval" | "cancel" | "delete-all" | "status" | "streams",
): Response {
  return new APIError(401, "auth_token_missing", "Missing internal user header", {
    hint: `Call AgentRun ${surface} through agent-worker.`,
    retriable: false,
  }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
}

export async function readMastraChunk(
  iterator: AsyncIterator<unknown>,
  timeoutMs?: number,
  abortController?: AbortController,
  extendWhile?: () => boolean,
): Promise<MastraChunkRead> {
  if (!timeoutMs) {
    return iterator.next();
  }
  return resolveWithAbortTimeout({
    abortController: abortController ?? new AbortController(),
    ...(extendWhile ? { extendWhile } : {}),
    operation: iterator.next(),
    timeoutMs,
  });
}
