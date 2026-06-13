import { gatewayRequestUrl } from "@cheatcode/api-client";
import { env } from "@cheatcode/env/web";
import {
  type FeaturedReplays,
  FeaturedReplaysSchema,
  type PublicReplay,
  PublicReplaySchema,
} from "@cheatcode/types";

/**
 * Carries the gateway HTTP status so `ReplayView` can render branded
 * not-found content for 400/404 (uniform "unavailable" cases) while reserving a
 * retry affordance for transient/network failures.
 */
export class ReplayRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Replay request failed with HTTP ${status}`);
    this.name = "ReplayRequestError";
    this.status = status;
  }
}

/**
 * Fetches one curated replay transcript. Runs in the visitor's browser (the
 * react-query queryFn inside `ReplayView`) so the sanitized payload is
 * inspectable in the network tab. Unauthenticated — no `authorizedFetch`.
 */
export async function fetchPublicReplay(id: string): Promise<PublicReplay> {
  const response = await fetch(
    gatewayRequestUrl(env.NEXT_PUBLIC_GATEWAY_URL, `/v1/replays/${encodeURIComponent(id)}`),
  );
  if (!response.ok) {
    throw new ReplayRequestError(response.status);
  }
  return PublicReplaySchema.parse(await response.json());
}

/**
 * Fetches the curated featured-replay rows for the home card. Runs server-side
 * inside the home page's async server component (Next data cache absorbs repeat
 * renders). Any non-OK response degrades to an empty list so the card hides
 * gracefully (e.g. gateway unreachable in local/staging).
 */
export async function fetchFeaturedReplays(): Promise<FeaturedReplays> {
  const response = await fetch(
    gatewayRequestUrl(env.NEXT_PUBLIC_GATEWAY_URL, "/v1/replays/featured"),
    { next: { revalidate: 300 } },
  );
  if (!response.ok) {
    return { data: [] };
  }
  return FeaturedReplaysSchema.parse(await response.json());
}
