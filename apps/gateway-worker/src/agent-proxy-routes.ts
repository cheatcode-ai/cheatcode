import {
  APIError,
  readBoundedRequestText,
  readBoundedResponseJson,
} from "@cheatcode/observability";
import {
  ApprovalDecisionRequestSchema,
  ApprovalDecisionResponseSchema,
  SandboxConsoleQuerySchema,
  SandboxConsoleSnapshotSchema,
} from "@cheatcode/types";
import type { Context } from "hono";
import type { z } from "zod";
import { agentServiceHeaders, agentServiceRequest } from "./agent-forwarding";
import { authenticate } from "./authenticate";
import type { GatewayEnv } from "./gateway-env";
import { rateLimit, withRateLimitHeaders } from "./rate-limit";

type GatewayProxyContext = Context<{ Bindings: GatewayEnv }>;

const APPROVAL_DECISION_ROUTE = "POST /v1/runs/:runId/approvals/:approvalId";
const MAX_APPROVAL_BODY_BYTES = 4 * 1024;
const MAX_APPROVAL_RESPONSE_BYTES = 16 * 1024;
const MAX_CONSOLE_RESPONSE_BYTES = 2 * 1024 * 1024;
const SANDBOX_CONSOLE_ROUTE = "GET /v1/threads/:threadId/sandbox/console";

/**
 * `POST /v1/runs/:runId/approvals/:approvalId` — validates the allow/deny body
 * at the public boundary, forwards verbatim to the agent-worker (which routes to
 * the AgentRun DO for ownership + state-machine enforcement, emitting `404`
 * for a missing run or `409` when the approval cannot be resolved), then re-parses the
 * `200` resolution before returning it.
 */
export async function decideRunApprovalRoute(c: GatewayProxyContext): Promise<Response> {
  const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
  const rateLimitHeaders = await rateLimit(c, userId, APPROVAL_DECISION_ROUTE);
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_APPROVAL_BODY_BYTES,
    "Approval decision",
  );
  const parsed = ApprovalDecisionRequestSchema.safeParse(parseJsonRequestBody(rawBody));
  if (!parsed.success) {
    throw invalidRequestBody("Invalid approval decision payload", parsed.error);
  }
  const forwarded = new Request(c.req.raw.url, {
    body: rawBody,
    headers: agentServiceHeaders(c.req.raw.headers, userId),
    method: "POST",
  });
  const response = await c.env.AGENT.fetch(forwarded);
  return withRateLimitHeaders(
    await parseForwardedJsonResponse(
      response,
      ApprovalDecisionResponseSchema,
      MAX_APPROVAL_RESPONSE_BYTES,
      "Agent approval",
    ),
    rateLimitHeaders,
  );
}

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

function parseJsonRequestBody(rawBody: string): unknown {
  if (!rawBody.trim()) {
    return {};
  }
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new APIError(400, "invalid_request_body", "Request body must be valid JSON", {
      retriable: false,
    });
  }
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

function invalidRequestBody(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_request_body", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}

function invalidQueryParam(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_query_param", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}
