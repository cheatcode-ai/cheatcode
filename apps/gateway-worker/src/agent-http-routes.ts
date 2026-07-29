import { AGENT_FORWARD_ROUTES } from "@cheatcode/types/internal";
import {
  agentServiceHeaders,
  forwardAgentRequest,
  skillRuntimeServiceRequest,
} from "./agent-forwarding";
import { validateSandboxConsoleQuery } from "./agent-proxy-routes";
import { authenticate, requireVerifiedClerkEmail } from "./authenticate";
import type { GatewayApp, GatewayContext } from "./gateway-env";
import { completeIdempotentRunRequest, prepareIdempotentRunRequest } from "./idempotency";
import { rateLimit, withRateLimitHeaders } from "./rate-limit";

export function registerAgentHttpRoutes(app: GatewayApp): void {
  app.all("/skill-runtime/*", (c) => c.env.AGENT.fetch(skillRuntimeServiceRequest(c.req.raw)));
  app.post("/v1/threads/:threadId/runs", async (c) => createRunRoute(c));
  for (const route of Object.values(AGENT_FORWARD_ROUTES.piped)) {
    app.on(route.method, route.path, (c) =>
      forwardAgentRequest(
        c,
        route,
        route.path === AGENT_FORWARD_ROUTES.piped.sandboxConsole.path
          ? validateSandboxConsoleQuery
          : undefined,
      ),
    );
  }
}

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
