import { APIError } from "@cheatcode/observability";

/** Requests that are required to finish or erase work admitted before draining. */
export function isAgentRunDrainContinuation(request: Request): boolean {
  if (request.method !== "POST") {
    return false;
  }
  const pathname = new URL(request.url).pathname;
  return (
    pathname === "/workflow/execute" ||
    pathname === "/workflow/failed" ||
    pathname === "/workflow/rollover" ||
    pathname === "/delete-all"
  );
}

export function agentRunReleaseGateResponse(releaseGate: "closed" | "draining"): Response {
  const response = new APIError(503, "unavailable_maintenance", "Release is in progress", {
    details: { releaseGate, worker: "agent" },
    retriable: true,
  }).toResponse(requestId());
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Retry-After", "5");
  return response;
}

export function deletedAgentRunResponse(): Response {
  return new APIError(410, "not_found_run", "Run state was permanently deleted", {
    retriable: false,
  }).toResponse(requestId());
}

export function absentAgentRunOkResponse(): Response {
  return Response.json({ ok: true });
}

export function absentAgentRunWorkflowResponse(): Response {
  return Response.json({ outcome: "deleted", status: "deleted" });
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
