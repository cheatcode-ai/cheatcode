import { APIError, createLogger } from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import { type RateLimitResult, RateLimitResultSchema } from "./durable-objects/rate-limit-contract";
import type { RateLimiter } from "./durable-objects/rate-limiter";

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
}

const RATE_LIMIT_POLICIES = {
  publicRead: { className: "public.read", cost: 1, limitPerMinute: 300 },
  publicWrite: { className: "public.write", cost: 1, limitPerMinute: 60 },
  readCheap: { className: "read.cheap", cost: 1, limitPerMinute: 600 },
  readExpensive: { className: "read.expensive", cost: 5, limitPerMinute: 60 },
  runsCreate: { className: "runs.create", cost: 10, limitPerMinute: 30 },
  writeNormal: { className: "write.normal", cost: 3, limitPerMinute: 120 },
} as const satisfies Record<string, RateLimitPolicy>;

export async function rateLimit(
  c: RateLimitContext,
  userId: UserId,
  route: string,
): Promise<RateLimitHeaders | null> {
  const policy = policyForRoute(route);
  const id = c.env.RATE_LIMITER.idFromName(`ratelimit:${userId.slice(0, 8)}`);
  const stub = c.env.RATE_LIMITER.get(id);
  const body = JSON.stringify({
    key: `${userId}:${route}`,
    cost: policy.cost,
    config: rateLimitConfig(policy),
  });
  let response: Response;
  try {
    response = await stub.fetch("https://rate-limit.internal/consume", { body, method: "POST" });
  } catch (error) {
    logRateLimitFailure(route, error);
    return null;
  }
  if (!response.ok) {
    logRateLimitFailure(route, new Error(`Rate limiter returned HTTP ${response.status}`));
    return null;
  }
  let result: RateLimitResult;
  try {
    result = RateLimitResultSchema.parse(await response.json());
  } catch (error) {
    logRateLimitFailure(route, error);
    return null;
  }
  const headers = rateLimitHeaders(policy, result);
  setRateLimitHeaders(c, headers);
  if (!result.allowed) {
    throw new APIError(429, "rate_limit_exceeded", "Too many requests", {
      hint: `Retry after ${Math.ceil(result.retryAfterMs / 1000)} seconds.`,
      retriable: true,
      details: {
        class: policy.className,
        retry_after_ms: result.retryAfterMs,
      },
    });
  }
  return headers;
}

export function ensureFallbackRateLimitHeaders(headers: Headers, request: Request): void {
  const policy = fallbackPolicyForRequest(request);
  const fallback: RateLimitHeaders = {
    limit: String(policy.limitPerMinute),
    remaining: String(policy.limitPerMinute - 1),
    reset: rateLimitReset(60_000),
  };
  if (!headers.has("RateLimit-Limit")) {
    headers.set("RateLimit-Limit", fallback.limit);
  }
  if (!headers.has("RateLimit-Remaining")) {
    headers.set("RateLimit-Remaining", fallback.remaining);
  }
  if (!headers.has("RateLimit-Reset")) {
    headers.set("RateLimit-Reset", fallback.reset);
  }
}

export function withRateLimitHeaders(
  response: Response,
  headers: RateLimitHeaders | null,
): Response {
  if (!headers) {
    return response;
  }
  const next = new Response(response.body, response);
  next.headers.set("RateLimit-Limit", headers.limit);
  next.headers.set("RateLimit-Remaining", headers.remaining);
  next.headers.set("RateLimit-Reset", headers.reset);
  return next;
}

function policyForRoute(route: string): RateLimitPolicy {
  if (route === "POST /v1/threads/:threadId/runs") {
    return RATE_LIMIT_POLICIES.runsCreate;
  }
  if (route === "GET /v1/threads/:threadId/runs/stream" || isSandboxReadRoute(route)) {
    return RATE_LIMIT_POLICIES.readExpensive;
  }
  if (route.startsWith("GET ")) {
    return RATE_LIMIT_POLICIES.readCheap;
  }
  return RATE_LIMIT_POLICIES.writeNormal;
}

function isSandboxReadRoute(route: string): boolean {
  return route.startsWith("GET /v1/threads/:threadId/sandbox/");
}

function fallbackPolicyForRequest(request: Request): RateLimitPolicy {
  const url = new URL(request.url);
  if (url.pathname === "/v1/client-error" || url.pathname === "/v1/vitals") {
    return RATE_LIMIT_POLICIES.publicWrite;
  }
  if (
    /^\/v1\/outputs\/[^/]+\/download$/.test(url.pathname) ||
    url.pathname === "/health" ||
    url.pathname === "/docs" ||
    url.pathname === "/openapi.json"
  ) {
    return RATE_LIMIT_POLICIES.publicRead;
  }
  return policyForRoute(normalizeRouteForPolicy(request.method, url.pathname));
}

function normalizeRouteForPolicy(method: string, pathname: string): string {
  if (method === "POST" && /^\/v1\/threads\/[^/]+\/runs$/.test(pathname)) {
    return "POST /v1/threads/:threadId/runs";
  }
  if (method === "GET" && /^\/v1\/threads\/[^/]+\/runs\/stream$/.test(pathname)) {
    return "GET /v1/threads/:threadId/runs/stream";
  }
  if (method === "GET" && /^\/v1\/threads\/[^/]+\/sandbox\//.test(pathname)) {
    return "GET /v1/threads/:threadId/sandbox/*";
  }
  return `${method} ${pathname}`;
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
  c.header("RateLimit-Limit", headers.limit);
  c.header("RateLimit-Remaining", headers.remaining);
  c.header("RateLimit-Reset", headers.reset);
}

function rateLimitReset(retryAfterMs: number): string {
  const resetMs = retryAfterMs > 0 ? retryAfterMs : 60_000;
  return String(Math.ceil((Date.now() + resetMs) / 1000));
}

function logRateLimitFailure(route: string, error: unknown): void {
  createLogger().warn("rate_limiter_unavailable", {
    errorMessage: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : typeof error,
    route,
  });
}
