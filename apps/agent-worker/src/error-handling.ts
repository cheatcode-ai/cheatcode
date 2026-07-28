import { APIError, toAPIError } from "@cheatcode/observability";
import { z } from "zod";

export function formatAgentRouteError(error: unknown, requestId: string): Response {
  return toAgentRouteError(error).toResponse(requestId);
}

export function toAgentRouteError(error: unknown): APIError {
  if (error instanceof z.ZodError) {
    return new APIError(400, "invalid_request_body", "Invalid request payload", {
      details: { issues: error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  return toAPIError(error);
}
