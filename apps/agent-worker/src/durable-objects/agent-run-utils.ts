import type { executeRunCodeTool } from "@cheatcode/agent-core";
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

export function isAppBuilderRequest(messageText: string): boolean {
  return /create-next-app|next app|hot-?reload/i.test(messageText);
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

export function formatRunCodeFallbackOutput(
  result: Awaited<ReturnType<typeof executeRunCodeTool>>,
): string {
  const stdout = result.stdout.trimEnd();
  const stderr = result.stderr.trimEnd();
  const lines = ["Sandbox run completed."];
  if (stdout) {
    lines.push("", "stdout:", "```text", stdout, "```");
  }
  if (stderr) {
    lines.push("", "stderr:", "```text", stderr, "```");
  }
  if (result.exitCode !== null) {
    lines.push("", `exit code: ${result.exitCode}`);
  }
  return `${lines.join("\n")}\n`;
}

export function runCodeFallbackIntro(): string {
  return "Model stream timed out before the first chunk; running Python directly through runCode.\n";
}
