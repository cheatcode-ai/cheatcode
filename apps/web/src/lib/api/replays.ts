import { gatewayRequestUrl } from "@cheatcode/api-client";
import { env } from "@cheatcode/env/web";
import {
  type FeaturedReplays,
  FeaturedReplaysSchema,
  type PublicReplay,
  PublicReplaySchema,
  type ReplayShare,
  ReplayShareSchema,
  type UpdateReplayShare,
} from "@cheatcode/types";
import { authorizedFetch } from "@/lib/api/authorized-fetch";

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

/**
 * Publishes one of the caller's own runs as a read-only replay (idempotent: the
 * gateway returns the existing active share for the thread). Authenticated.
 */
export async function createReplayShare(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<ReplayShare> {
  const response = await authorizedFetch(getToken, "/v1/replays", {
    body: JSON.stringify({ threadId }),
    method: "POST",
  });
  return ReplayShareSchema.parse(await response.json());
}

/** Returns the caller's active share for a thread, or null. Authenticated. */
export async function fetchReplayShareForThread(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<ReplayShare | null> {
  const response = await authorizedFetch(
    getToken,
    `/v1/threads/${encodeURIComponent(threadId)}/replay-share`,
  );
  const body = (await response.json()) as { share: unknown };
  return body.share ? ReplayShareSchema.parse(body.share) : null;
}

/** Changes visibility and/or revokes a replay share the caller owns. Authenticated. */
export async function updateReplayShare(
  getToken: () => Promise<null | string>,
  id: string,
  input: UpdateReplayShare,
): Promise<ReplayShare> {
  const response = await authorizedFetch(getToken, `/v1/replays/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    method: "PATCH",
  });
  return ReplayShareSchema.parse(await response.json());
}
