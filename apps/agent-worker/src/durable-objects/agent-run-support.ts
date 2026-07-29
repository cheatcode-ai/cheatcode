import type { AgentChunkType } from "@cheatcode/agent-core";
import { APIError } from "@cheatcode/observability";
import { resolveWithAbortTimeout } from "./abort-timeout";

export type MastraChunkRead = IteratorResult<AgentChunkType, unknown> | "timeout";

export function missingInternalUserResponse(
  surface: "browser takeover" | "cancel" | "delete-all" | "status" | "streams",
): Response {
  return new APIError(401, "auth_token_missing", "Missing internal user header", {
    hint: `Call AgentRun ${surface} through agent-worker.`,
    retriable: false,
  }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
}

export async function readMastraChunk(
  iterator: AsyncIterator<AgentChunkType>,
  timeoutMs?: number,
  abortController?: AbortController,
): Promise<MastraChunkRead> {
  if (!timeoutMs) {
    return iterator.next();
  }
  return resolveWithAbortTimeout({
    abortController: abortController ?? new AbortController(),
    operation: iterator.next(),
    timeoutMs,
  });
}
