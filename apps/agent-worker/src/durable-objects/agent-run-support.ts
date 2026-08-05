import { APIError } from "@cheatcode/observability";

export interface RunIdentity {
  runId: string;
  threadId: string;
  userId: string;
}

export type TerminalRunStatus = "canceled" | "completed" | "failed";

export function missingInternalUserResponse(
  surface: "browser takeover" | "cancel" | "delete-all" | "status" | "streams",
): Response {
  return new APIError(401, "auth_token_missing", "Missing internal user header", {
    hint: `Call AgentRun ${surface} through agent-worker.`,
    retriable: false,
  }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
}

export function invalidResumeCursorResponse(): Response {
  return new APIError(400, "request_query_param_invalid", "Invalid resume cursor", {
    hint: "Pass lastSeq as a non-negative integer.",
    retriable: false,
  }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
}
