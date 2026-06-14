import { resolveWorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import { z } from "zod";
import type { PreviewProxyEnv } from "./env";
import type { PreviewTarget } from "./host";

/**
 * Daytona returns the real preview origin plus a per-sandbox preview token that
 * the proxy must echo back as `x-daytona-preview-token`. The token rotates when
 * a sandbox restarts, so we cache it only briefly and re-fetch on a 401/403 from
 * the origin (see `proxy.ts`). The module-scope Map is per-isolate, which is the
 * correct cache scope for a Worker.
 */
const ORIGIN_CACHE_TTL_MS = 60_000;

const PreviewUrlResponseSchema = z.object({
  token: z.string().min(1),
  url: z.string().url(),
});

export interface PreviewOrigin {
  readonly token: string;
  readonly url: string;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly value: PreviewOrigin;
}

const ORIGIN_CACHE = new Map<string, CacheEntry>();

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
  }
  const value = await fetchPreviewOrigin(env, target);
  ORIGIN_CACHE.set(key, { expiresAt: Date.now() + ORIGIN_CACHE_TTL_MS, value });
  return value;
}

export function invalidatePreviewOrigin(target: PreviewTarget): void {
  ORIGIN_CACHE.delete(cacheKey(target));
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
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new APIError(502, "upstream_sandbox_failed", "Failed to resolve Daytona preview origin", {
      details: { status: response.status },
      retriable: true,
    });
  }
  const parsed = PreviewUrlResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new APIError(502, "upstream_sandbox_failed", "Malformed Daytona preview-url response", {
      retriable: true,
    });
  }
  return { token: parsed.data.token, url: parsed.data.url };
}

function cacheKey(target: PreviewTarget): string {
  return `${target.sandboxId}:${target.port}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
