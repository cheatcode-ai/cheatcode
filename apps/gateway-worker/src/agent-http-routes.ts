import { agentServiceHeaders, forwardAgentRequest } from "./agent-forwarding";
import { decideRunApprovalRoute, readSandboxConsoleRoute } from "./agent-proxy-routes";
import { authenticate, requireVerifiedClerkEmail } from "./authenticate";
import type { GatewayApp, GatewayContext } from "./gateway-env";
import { completeIdempotentRunRequest, prepareIdempotentRunRequest } from "./idempotency";
import { rateLimit, withRateLimitHeaders } from "./rate-limit";

export function registerAgentHttpRoutes(app: GatewayApp): void {
  app.post("/v1/threads/:threadId/runs", async (c) => createRunRoute(c));
  for (const [path, route] of GET_AGENT_ROUTES) {
    app.get(path, (c) => forwardAgentRequest(c, route));
  }
  for (const [path, route] of POST_AGENT_ROUTES) {
    app.post(path, (c) => forwardAgentRequest(c, route));
  }
  app.patch("/v1/threads/:threadId/sandbox/file", (c) =>
    forwardAgentRequest(c, "PATCH /v1/threads/:threadId/sandbox/file"),
  );
  app.post("/v1/runs/:runId/approvals/:approvalId", (c) => decideRunApprovalRoute(c));
  app.get("/v1/threads/:threadId/sandbox/console", (c) => readSandboxConsoleRoute(c));
}

const GET_AGENT_ROUTES = [
  ["/v1/threads/:threadId/runs/stream", "GET /v1/threads/:threadId/runs/stream"],
  ["/v1/threads/:threadId/runs/status", "GET /v1/threads/:threadId/runs/status"],
  ["/v1/computer/ide", "GET /v1/computer/ide"],
  ["/v1/computer/terminal/context", "GET /v1/computer/terminal/context"],
  ["/v1/threads/:threadId/sandbox/files", "GET /v1/threads/:threadId/sandbox/files"],
  ["/v1/threads/:threadId/sandbox/ide", "GET /v1/threads/:threadId/sandbox/ide"],
  [
    "/v1/threads/:threadId/sandbox/preview/status",
    "GET /v1/threads/:threadId/sandbox/preview/status",
  ],
  ["/v1/threads/:threadId/sandbox/file", "GET /v1/threads/:threadId/sandbox/file"],
  ["/v1/threads/:threadId/sandbox/file-preview", "GET /v1/threads/:threadId/sandbox/file-preview"],
  [
    "/v1/threads/:threadId/sandbox/terminal/context",
    "GET /v1/threads/:threadId/sandbox/terminal/context",
  ],
] as const;

const POST_AGENT_ROUTES = [
  ["/v1/runs/:runId/cancel", "POST /v1/runs/:runId/cancel"],
  ["/v1/computer/terminal", "POST /v1/computer/terminal"],
  ["/v1/threads/:threadId/sandbox/preview/wake", "POST /v1/threads/:threadId/sandbox/preview/wake"],
  ["/v1/threads/:threadId/sandbox/terminal", "POST /v1/threads/:threadId/sandbox/terminal"],
] as const;

async function createRunRoute(c: GatewayContext): Promise<Response> {
  const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
  const rateLimitHeaders = await rateLimit(c, userId, "POST /v1/threads/:threadId/runs");
  await requireVerifiedClerkEmail(c.req.raw, c.env);
  const prepared = await prepareIdempotentRunRequest(c.env, c.req.raw, userId);
  if (prepared.replay) {
    return withRateLimitHeaders(prepared.replay, rateLimitHeaders);
  }
  const forward = () => {
    const request = new Request(c.req.raw.url, {
      body: prepared.body,
      headers: agentServiceHeaders(c.req.raw.headers, userId),
      method: c.req.raw.method,
    });
    request.headers.set("X-Cheatcode-Idempotency-Key-Hash", prepared.keyHash);
    request.headers.set("X-Cheatcode-Request-Body-Hash", prepared.bodyHash);
    request.headers.set("X-Cheatcode-User-Id", userId);
    return c.env.AGENT.fetch(request);
  };
  let response: Response;
  let hasRetried = false;
  try {
    response = await forward();
  } catch {
    // The agent's database uniqueness key and run-keyed Durable Object make
    // this retry at-most-once even when the first service-binding response was lost.
    hasRetried = true;
    response = await forward();
  }
  if (!hasRetried && response.status >= 500) {
    await response.body?.cancel().catch(() => undefined);
    // A Worker 5xx can be emitted after the downstream request committed but before
    // its response was delivered. The same persisted request identity makes retry safe.
    response = await forward();
  }
  await completeIdempotentRunRequest(c.env, userId, prepared.key, prepared.claimId, response);
  return withRateLimitHeaders(response, rateLimitHeaders);
}
