import { APIError } from "@cheatcode/observability";

export function deletedAgentRunResponse(): Response {
  return new APIError(410, "resource_run_not_found", "Run state was permanently deleted", {
    retriable: false,
  }).toResponse(requestId());
}

export function absentAgentRunOkResponse(): Response {
  return Response.json({ ok: true });
}

export function absentAgentRunWorkflowResponse(): Response {
  return Response.json({ outcome: "deleted" });
}

export function agentRunStreamCapacityResponse(): Response {
  return new APIError(429, "rate_limit_exceeded", "Too many agent stream subscribers", {
    hint: "Close another view of this run, then reconnect with the last received sequence.",
    retriable: true,
  }).toResponse(requestId());
}

export async function agentRunWorkflowResponse(
  operation: () => Promise<Response>,
): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof APIError) {
      return error.toResponse(requestId());
    }
    throw error;
  }
}

function requestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}
