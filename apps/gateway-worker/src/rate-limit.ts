import {
  APIError,
  createLogger,
  readBoundedResponseJson,
  safeErrorTelemetry,
} from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import { type RateLimitResult, RateLimitResultSchema } from "./durable-objects/rate-limit-contract";
import type { RateLimiter } from "./durable-objects/rate-limiter";
import { identifyDeclaredGatewayRoute } from "./openapi-route-parity";

type RateLimitClass =
  | "public.read"
  | "public.write"
  | "read.cheap"
  | "read.expensive"
  | "runs.create"
  | "write.normal";

interface RateLimitPolicy {
  className: RateLimitClass;
  cost: number;
  failClosed: boolean;
  limitPerMinute: number;
}

export interface RateLimitHeaders {
  limit: string;
  remaining: string;
  reset: string;
}

export interface RateLimitContext {
  env: {
    RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  };
  header(name: string, value: string): void;
  readonly res: Response;
}

interface PublicRateLimitContext extends RateLimitContext {
  req: { raw: Request };
}

type PublicRateLimitPolicyName = "publicRead" | "publicWrite";

interface RateLimitSubject {
  durableObjectName: string;
  key: string;
}

// A bounded 256-shard pool avoids creating a permanently alarmed Durable Object per client IP.
const PUBLIC_RATE_LIMIT_SHARD_PREFIX_LENGTH = 2;
const MAX_RATE_LIMIT_RESPONSE_BYTES = 16 * 1024;

const RATE_LIMIT_POLICIES = {
  publicRead: { className: "public.read", cost: 1, failClosed: false, limitPerMinute: 300 },
  publicWrite: { className: "public.write", cost: 1, failClosed: true, limitPerMinute: 60 },
  readCheap: { className: "read.cheap", cost: 1, failClosed: false, limitPerMinute: 600 },
  readExpensive: { className: "read.expensive", cost: 5, failClosed: true, limitPerMinute: 60 },
  runsCreate: { className: "runs.create", cost: 10, failClosed: true, limitPerMinute: 30 },
  writeNormal: { className: "write.normal", cost: 3, failClosed: true, limitPerMinute: 120 },
} as const satisfies Record<string, RateLimitPolicy>;

export async function rateLimit(
  c: RateLimitContext,
  userId: UserId,
  route: string,
): Promise<RateLimitHeaders | null> {
  const identity = identifyDeclaredGatewayRoute(route);
  return consumeRateLimit(
    c,
    {
      durableObjectName: `ratelimit:${userId.slice(0, 8)}`,
      key: `user:${userId}:${identity.operationId}`,
    },
    identity.operationId,
    policyForRoute(identity.routeKey),
  );
}

export async function rateLimitPublic(
  c: PublicRateLimitContext,
  route: string,
  policyName: PublicRateLimitPolicyName,
): Promise<RateLimitHeaders | null> {
  const identity = identifyDeclaredGatewayRoute(route);
  const addressHash = await publicClientAddressHash(c.req.raw);
  return consumeRateLimit(
    c,
    {
      durableObjectName: `ratelimit:public:${addressHash.slice(
        0,
        PUBLIC_RATE_LIMIT_SHARD_PREFIX_LENGTH,
      )}`,
      key: `public:${addressHash}:${identity.operationId}`,
    },
    identity.operationId,
    RATE_LIMIT_POLICIES[policyName],
  );
}

async function consumeRateLimit(
  c: RateLimitContext,
  subject: RateLimitSubject,
  operationId: string,
  policy: RateLimitPolicy,
): Promise<RateLimitHeaders | null> {
  const id = c.env.RATE_LIMITER.idFromName(subject.durableObjectName);
  const stub = c.env.RATE_LIMITER.get(id);
  const body = JSON.stringify({
    key: subject.key,
    cost: policy.cost,
    config: rateLimitConfig(policy),
  });
  let response: Response;
  try {
    response = await stub.fetch("https://rate-limit.internal/consume", { body, method: "POST" });
  } catch (error) {
    return handleRateLimitFailure(operationId, policy, error);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return handleRateLimitFailure(
      operationId,
      policy,
      new Error(`Rate limiter returned HTTP ${response.status}`),
    );
  }
  let result: RateLimitResult;
  try {
    result = RateLimitResultSchema.parse(
      await readBoundedResponseJson(response, MAX_RATE_LIMIT_RESPONSE_BYTES, "Rate limiter"),
    );
  } catch (error) {
    return handleRateLimitFailure(operationId, policy, error);
  }
  const headers = rateLimitHeaders(policy, result);
  if (!result.allowed) {
    throw new RateLimitExceededError(headers, policy, result.retryAfterMs);
  }
  setRateLimitHeaders(c, headers);
  return headers;
}

export function withRateLimitErrorHeaders(response: Response, error: unknown): Response {
  if (!(error instanceof RateLimitExceededError)) {
    return response;
  }
  const next = new Response(response.body, response);
  applyRateLimitHeaders(next.headers, error.rateLimitHeaders);
  next.headers.set("Retry-After", String(error.retryAfterSeconds));
  return next;
}

export function withRateLimitHeaders(
  response: Response,
  headers: RateLimitHeaders | null,
): Response {
  if (!headers) {
    return response;
  }
  const next = new Response(response.body, response);
  applyRateLimitHeaders(next.headers, headers);
  return next;
}

function policyForRoute(route: string): RateLimitPolicy {
  if (route === "POST /v1/threads/{threadId}/runs") {
    return RATE_LIMIT_POLICIES.runsCreate;
  }
  if (route === "POST /v1/projects/{projectId}/download") {
    return RATE_LIMIT_POLICIES.readExpensive;
  }
  if (route === "GET /v1/threads/{threadId}/runs/stream" || isSandboxReadRoute(route)) {
    return RATE_LIMIT_POLICIES.readExpensive;
  }
  if (route.startsWith("GET ")) {
    return RATE_LIMIT_POLICIES.readCheap;
  }
  return RATE_LIMIT_POLICIES.writeNormal;
}

function isSandboxReadRoute(route: string): boolean {
  return (
    route.startsWith("GET /v1/threads/{threadId}/sandbox/") || route.startsWith("GET /v1/computer/")
  );
}

function rateLimitConfig(policy: RateLimitPolicy): { capacity: number; refillPerSec: number } {
  const capacity = policy.limitPerMinute * policy.cost;
  return { capacity, refillPerSec: capacity / 60 };
}

function rateLimitHeaders(policy: RateLimitPolicy, result: RateLimitResult): RateLimitHeaders {
  return {
    limit: String(policy.limitPerMinute),
    remaining: String(Math.floor(result.remaining / policy.cost)),
    reset: rateLimitReset(result.retryAfterMs),
  };
}

function setRateLimitHeaders(c: RateLimitContext, headers: RateLimitHeaders): void {
  // Materialize Hono's response so these headers survive handlers that return a raw Response.
  void c.res;
  c.header("RateLimit-Limit", headers.limit);
  c.header("RateLimit-Remaining", headers.remaining);
  c.header("RateLimit-Reset", headers.reset);
}

function applyRateLimitHeaders(target: Headers, headers: RateLimitHeaders): void {
  target.set("RateLimit-Limit", headers.limit);
  target.set("RateLimit-Remaining", headers.remaining);
  target.set("RateLimit-Reset", headers.reset);
}

function rateLimitReset(retryAfterMs: number): string {
  const resetMs = retryAfterMs > 0 ? retryAfterMs : 60_000;
  return String(Math.ceil((Date.now() + resetMs) / 1000));
}

function logRateLimitFailure(operationId: string, error: unknown): void {
  createLogger().warn("rate_limiter_unavailable", {
    route: operationId,
    ...safeErrorTelemetry(error),
  });
}

function handleRateLimitFailure(
  operationId: string,
  policy: RateLimitPolicy,
  error: unknown,
): null {
  logRateLimitFailure(operationId, error);
  if (policy.failClosed) {
    throw new APIError(503, "unavailable_maintenance", "Request protection is unavailable", {
      hint: "Retry shortly. If this persists, check the gateway RateLimiter Durable Object.",
      retriable: true,
    });
  }
  return null;
}

async function publicClientAddressHash(request: Request): Promise<string> {
  const rawAddress = request.headers.get("CF-Connecting-IP")?.trim().toLowerCase();
  const address = rawAddress && rawAddress.length <= 64 ? rawAddress : "missing";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`cheatcode-public-rate-limit-v1\0${address}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

class RateLimitExceededError extends APIError {
  public readonly rateLimitHeaders: RateLimitHeaders;
  public readonly retryAfterSeconds: number;

  public constructor(
    rateLimitHeaders: RateLimitHeaders,
    policy: RateLimitPolicy,
    retryAfterMs: number,
  ) {
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
    super(429, "rate_limit_exceeded", "Too many requests", {
      details: {
        class: policy.className,
        retry_after_ms: retryAfterMs,
      },
      hint: `Retry after ${retryAfterSeconds} seconds.`,
      retriable: true,
    });
    this.rateLimitHeaders = rateLimitHeaders;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
