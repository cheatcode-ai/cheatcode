/**
 * Operator-curated featured-replay manifest (replays plan §2.1).
 *
 * This is a checked-in static const — the same build-time-bundled curation
 * pattern V2 already uses for skills (`packages/skills/src/generated.ts`).
 * Workers have no runtime filesystem, so the curated set lives as a typed const
 * the gateway resolves on every `GET /v1/replays/featured` / `GET /v1/replays/:id`.
 *
 * There is NO DB table and NO migration: the read routes resolve a manifest
 * `id` (public slug) to an internal `threadId`, then read the existing
 * `v2_messages`/`v2_threads`. Entries whose thread does not resolve in the
 * current environment are filtered out at read time, so non-prod envs (and
 * later-deleted demo threads) gracefully shrink the featured list to empty,
 * which hides the home card.
 */

/** Task-type accent hint consumed by the later home-card UI round (Paper 3PV-0). */
export type FeaturedReplayAccentKind = "app" | "deck" | "research" | "data" | "landing" | "social";

export interface FeaturedReplayConfig {
  /** Public slug — what `/replay/:id` and the home-card link use. Stable, decoupled from the thread UUID. */
  id: string;
  /** Internal `v2_threads` UUID of the operator-vetted demo thread. */
  threadId: string;
  /** Operator-authored display title (does not read the live thread title). */
  title: string;
  /** Operator-authored one-line preview for the home card. */
  previewText: string;
  /** Optional UI icon hint for the later visual round. */
  accentKind?: FeaturedReplayAccentKind;
  /** Shown on the replay header; defaults to "the Cheatcode team" in the route. */
  authorName?: string;
}

/**
 * TODO(operator): replace these placeholder entries with the real prod demo
 * thread UUIDs once the ~6 Paper 3PV-0 demos are seeded (habit tracker,
 * 12-slide deck, 40-startup scan, CSV retention, café landing page, 8am social
 * pack). Seed each demo by running its prompt to completion, read the thread
 * UUID, and drop it in here. The placeholder UUIDs below resolve in no
 * environment, so until they are replaced the featured list is empty and the
 * home card stays hidden (the desired "empty → hide" behavior).
 */
export const FEATURED_REPLAYS: readonly FeaturedReplayConfig[] = [
  {
    accentKind: "app",
    id: "habit-tracker",
    previewText: "Watch the agent build a mobile habit tracker end to end.",
    threadId: "00000000-0000-0000-0000-000000000001",
    title: "Mobile habit tracker",
  },
  {
    accentKind: "deck",
    id: "pitch-deck",
    previewText: "A 12-slide investor deck generated from a one-line prompt.",
    threadId: "00000000-0000-0000-0000-000000000002",
    title: "12-slide pitch deck",
  },
];
