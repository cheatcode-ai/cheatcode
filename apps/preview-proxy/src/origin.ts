import { resolveWorkerSecret } from "@cheatcode/env";
import { APIError, readBoundedResponseText } from "@cheatcode/observability";
import {
  parseDaytonaPreviewHostSuffixes,
  parseDaytonaPreviewLink,
} from "@cheatcode/types/daytona-preview";
import type { PreviewProxyEnv } from "./env";
import type { PreviewTarget } from "./host";

/**
 * Daytona returns the real preview origin plus a per-sandbox preview token that
 * the proxy must echo back as `x-daytona-preview-token`. The token rotates when
 * a sandbox restarts, so we cache it only briefly. Origin-auth failures use a
 * generation check and cooldown before refreshing (safe retries live in
 * `proxy.ts`). The module-scope Maps are per-isolate, the correct cache scope
 * for a Worker.
 */
const ORIGIN_CACHE_TTL_MS = 60_000;
const ORIGIN_CACHE_MAX_ENTRIES = 1_000;
const ORIGIN_REQUEST_TIMEOUT_MS = 10_000;
const ORIGIN_RESPONSE_MAX_BYTES = 16 * 1_024;
const AUTH_REFRESH_COOLDOWN_MS = 30_000;

export interface PreviewOrigin {
  readonly token: string;
  readonly url: string;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly value: PreviewOrigin;
}

const ORIGIN_CACHE = new Map<string, CacheEntry>();
const ORIGIN_RESOLUTIONS = new Map<string, Promise<PreviewOrigin>>();
const AUTH_REFRESH_ATTEMPTS = new Map<string, number>();

export async function resolvePreviewOrigin(
  env: PreviewProxyEnv,
  target: PreviewTarget,
  options: { forceRefresh?: boolean } = {},
): Promise<PreviewOrigin> {
  const key = cacheKey(target);
  if (!options.forceRefresh) {
    const cached = ORIGIN_CACHE.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    ORIGIN_CACHE.delete(key);
  }
  const pending = ORIGIN_RESOLUTIONS.get(key);
  if (pending) {
    return pending;
  }
  const resolution = fetchPreviewOrigin(env, target)
    .then((value) => {
      cachePreviewOrigin(key, value);
      return value;
    })
    .finally(() => ORIGIN_RESOLUTIONS.delete(key));
  ORIGIN_RESOLUTIONS.set(key, resolution);
  return resolution;
}

/**
 * Refresh a rotated Daytona credential at most once per target/cooldown. The
 * failed credential is compared with the cache so concurrent failures reuse a
 * newer generation instead of repeatedly invalidating it. Returns null when a
 * generated app's own 401/403 is the likely source or the lookup is unavailable.
 */
export async function refreshPreviewOriginAfterAuthFailure(
  env: PreviewProxyEnv,
  target: PreviewTarget,
  failedOrigin: PreviewOrigin,
): Promise<PreviewOrigin | null> {
  const key = cacheKey(target);
  const now = Date.now();
  const cached = freshCacheEntry(key, now);
  if (cached && !sameOrigin(cached.value, failedOrigin)) {
    return cached.value;
  }
  const pending = ORIGIN_RESOLUTIONS.get(key);
  if (pending) {
    const resolved = await pending.catch(() => null);
    return resolved && !sameOrigin(resolved, failedOrigin) ? resolved : null;
  }
  const lastAttempt = AUTH_REFRESH_ATTEMPTS.get(key) ?? 0;
  if (now - lastAttempt < AUTH_REFRESH_COOLDOWN_MS) {
    return null;
  }
  recordAuthRefreshAttempt(key, now);
  if (cached) {
    ORIGIN_CACHE.delete(key);
  }
  const refreshed = await resolvePreviewOrigin(env, target, { forceRefresh: true }).catch(
    () => null,
  );
  return refreshed && !sameOrigin(refreshed, failedOrigin) ? refreshed : null;
}

function cachePreviewOrigin(key: string, value: PreviewOrigin): void {
  if (!ORIGIN_CACHE.has(key) && ORIGIN_CACHE.size >= ORIGIN_CACHE_MAX_ENTRIES) {
    const oldestKey = ORIGIN_CACHE.keys().next().value;
    if (oldestKey) {
      ORIGIN_CACHE.delete(oldestKey);
      AUTH_REFRESH_ATTEMPTS.delete(oldestKey);
    }
  }
  ORIGIN_CACHE.set(key, { expiresAt: Date.now() + ORIGIN_CACHE_TTL_MS, value });
}

function freshCacheEntry(key: string, now: number): CacheEntry | null {
  const cached = ORIGIN_CACHE.get(key);
  if (cached && cached.expiresAt > now) {
    return cached;
  }
  ORIGIN_CACHE.delete(key);
  return null;
}

function recordAuthRefreshAttempt(key: string, now: number): void {
  if (!AUTH_REFRESH_ATTEMPTS.has(key) && AUTH_REFRESH_ATTEMPTS.size >= ORIGIN_CACHE_MAX_ENTRIES) {
    const oldestKey = AUTH_REFRESH_ATTEMPTS.keys().next().value;
    if (oldestKey) {
      AUTH_REFRESH_ATTEMPTS.delete(oldestKey);
    }
  }
  AUTH_REFRESH_ATTEMPTS.delete(key);
  AUTH_REFRESH_ATTEMPTS.set(key, now);
}

function sameOrigin(left: PreviewOrigin, right: PreviewOrigin): boolean {
  return left.url === right.url && left.token === right.token;
}

async function fetchPreviewOrigin(
  env: PreviewProxyEnv,
  target: PreviewTarget,
): Promise<PreviewOrigin> {
  const apiKey = await resolveWorkerSecret(env.DAYTONA_API_KEY);
  if (!apiKey) {
    throw new APIError(502, "upstream_sandbox_failed", "Daytona API key is not configured", {
      retriable: false,
    });
  }
  const endpoint = `${trimTrailingSlash(env.DAYTONA_API_URL)}/sandbox/${encodeURIComponent(
    target.sandboxId,
  )}/ports/${encodeURIComponent(target.port)}/preview-url`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(ORIGIN_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new APIError(502, "upstream_sandbox_failed", "Daytona preview lookup failed", {
      retriable: true,
    });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new APIError(502, "upstream_sandbox_failed", "Failed to resolve Daytona preview origin", {
      details: { status: response.status },
      retriable: true,
    });
  }
  return parsePreviewOriginResponse(response, env.DAYTONA_PREVIEW_HOST_SUFFIXES);
}

async function parsePreviewOriginResponse(
  response: Response,
  configuredHostSuffixes: string | undefined,
): Promise<PreviewOrigin> {
  let payload: unknown;
  try {
    payload = JSON.parse(
      await readBoundedResponseText(response, ORIGIN_RESPONSE_MAX_BYTES, "Daytona preview origin"),
    ) as unknown;
  } catch {
    throw malformedPreviewOriginResponse();
  }
  try {
    const parsed = parseDaytonaPreviewLink(
      payload,
      parseDaytonaPreviewHostSuffixes(configuredHostSuffixes),
    );
    return { token: parsed.token, url: parsed.url };
  } catch {
    throw malformedPreviewOriginResponse();
  }
}

function malformedPreviewOriginResponse(): APIError {
  return new APIError(502, "upstream_sandbox_failed", "Malformed Daytona preview-url response", {
    retriable: true,
  });
}

function cacheKey(target: PreviewTarget): string {
  return `${target.sandboxId}:${target.port}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
