import { APIError, toAPIError } from "@cheatcode/observability";
import { z } from "zod";

export function formatAgentRouteError(error: unknown, requestId: string): Response {
  if (error instanceof z.ZodError) {
    return new APIError(400, "invalid_request_body", "Invalid request payload", {
      details: { issues: error.issues.map((issue) => issue.message) },
      retriable: false,
    }).toResponse(requestId);
  }
  return toAPIError(error).toResponse(requestId);
}
