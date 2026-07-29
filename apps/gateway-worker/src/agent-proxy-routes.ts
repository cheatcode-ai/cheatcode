import { APIError } from "@cheatcode/observability";
import { SandboxConsoleQuerySchema } from "@cheatcode/types/api";
import type { z } from "zod";
import type { GatewayContext } from "./gateway-env";

/**
 * `GET /v1/threads/:threadId/sandbox/console` — cursor-poll for dev-server logs
 * (`read.expensive`). Validates the cursor/lastPid query at the public boundary
 * before the shared forwarder pipes the agent-worker response untouched.
 */
export function validateSandboxConsoleQuery(c: GatewayContext): void {
  const query = SandboxConsoleQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    throw invalidQueryParam("Invalid sandbox console query", query.error);
  }
}

function invalidQueryParam(message: string, error: z.ZodError): APIError {
  return new APIError(400, "request_query_param_invalid", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}
