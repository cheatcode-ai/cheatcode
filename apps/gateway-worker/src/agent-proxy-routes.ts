import { APIError, readBoundedResponseJson } from "@cheatcode/observability";
import { SandboxConsoleQuerySchema, SandboxConsoleSnapshotSchema } from "@cheatcode/types";
import type { Context } from "hono";
import type { z } from "zod";
import { agentServiceRequest } from "./agent-forwarding";
import { authenticate } from "./authenticate";
import type { GatewayEnv } from "./gateway-env";
import { rateLimit, withRateLimitHeaders } from "./rate-limit";

type GatewayProxyContext = Context<{ Bindings: GatewayEnv }>;

const MAX_CONSOLE_RESPONSE_BYTES = 2 * 1024 * 1024;
const SANDBOX_CONSOLE_ROUTE = "GET /v1/threads/:threadId/sandbox/console";

/**
 * `GET /v1/threads/:threadId/sandbox/console` — cursor-poll for dev-server logs
 * (`read.expensive`). Validates the cursor/lastPid query at the boundary,
 * forwards to the agent-worker (which resolves the thread's ProjectSandbox and
 * reads the dev-server console), then re-parses the snapshot.
 */
export async function readSandboxConsoleRoute(c: GatewayProxyContext): Promise<Response> {
  const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
  const rateLimitHeaders = await rateLimit(c, userId, SANDBOX_CONSOLE_ROUTE);
  const query = SandboxConsoleQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    throw invalidQueryParam("Invalid sandbox console query", query.error);
  }
  const forwarded = agentServiceRequest(c.req.raw, userId);
  const response = await c.env.AGENT.fetch(forwarded);
  return withRateLimitHeaders(
    await parseForwardedJsonResponse(
      response,
      SandboxConsoleSnapshotSchema,
      MAX_CONSOLE_RESPONSE_BYTES,
      "Agent console",
    ),
    rateLimitHeaders,
  );
}

async function parseForwardedJsonResponse<Schema extends z.ZodTypeAny>(
  response: Response,
  schema: Schema,
  maxBytes: number,
  label: string,
): Promise<Response> {
  if (!response.ok) {
    return response;
  }
  const payload = await readBoundedResponseJson(response, maxBytes, label);
  const data = schema.parse(payload);
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
    status: response.status,
  });
}

function invalidQueryParam(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_query_param", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}
