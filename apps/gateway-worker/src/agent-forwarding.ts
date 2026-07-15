import { authenticate } from "./authenticate";
import type { GatewayContext } from "./gateway-env";
import { rateLimit, withRateLimitHeaders } from "./rate-limit";

const PUBLIC_CREDENTIAL_HEADERS = [
  "Authorization",
  "Cookie",
  "Idempotency-Key",
  "Proxy-Authorization",
] as const;

/**
 * Builds the header set for a Gateway -> Agent service-binding request. Public
 * credentials terminate at the gateway, and public callers may not inject the
 * reserved internal identity/capability namespace.
 */
export function agentServiceHeaders(source: Headers, userId?: string): Headers {
  const headers = new Headers(source);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("x-cheatcode-")) {
      headers.delete(name);
    }
  }
  for (const name of PUBLIC_CREDENTIAL_HEADERS) {
    headers.delete(name);
  }
  if (userId) {
    headers.set("X-Cheatcode-User-Id", userId);
  }
  return headers;
}

export function agentServiceRequest(request: Request, userId?: string): Request {
  return new Request(request, { headers: agentServiceHeaders(request.headers, userId) });
}

export async function forwardAgentRequest(c: GatewayContext, route: string): Promise<Response> {
  const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
  const headers = await rateLimit(c, userId, route);
  const forwarded = agentServiceRequest(c.req.raw, userId);
  return withRateLimitHeaders(await c.env.AGENT.fetch(forwarded), headers);
}
