import {
  createDb,
  type Database,
  findReplayShareById,
  listExistingThreadIds,
  listReplayMessages,
  type MessageRecord,
} from "@cheatcode/db";
import { APIError, createLogger } from "@cheatcode/observability";
import {
  FeaturedReplaysSchema,
  PublicReplaySchema,
  ThreadId,
  type UIMessagePart,
} from "@cheatcode/types";
import { z } from "zod";
import { FEATURED_REPLAYS, type FeaturedReplayConfig } from "./featured-replays";
import { sanitizeReplayParts } from "./replay-sanitize";

export interface ReplayRouteEnv {
  HYPERDRIVE: Hyperdrive;
}

const REPLAY_MESSAGE_LIMIT = 200;
const REPLAY_CACHE_CONTROL = "public, max-age=300";
const DEFAULT_AUTHOR_NAME = "the Cheatcode team";

/** Public slug format: lower-kebab, 1–64 chars, leading alphanumeric (replays plan §4.1). */
const ReplaySlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

interface SanitizedReplayMessage {
  createdAt: string;
  id: string;
  parts: UIMessagePart[];
  role: "assistant" | "user";
}

/**
 * `GET /v1/replays/featured` — unauthenticated. Returns the curated manifest
 * filtered to entries whose thread still resolves in this environment. Empty
 * `data` is valid (the home card hides). Reads only `v2_threads`/`v2_projects`
 * existence; no message data is touched here.
 */
export async function featuredReplaysRoute(
  env: ReplayRouteEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const threadIds = FEATURED_REPLAYS.map((entry) => ThreadId(entry.threadId));
    const existing = await listExistingThreadIds(db, { threadIds });
    const existingThreadIds = new Set<string>(existing);
    const data = FEATURED_REPLAYS.filter((entry) => existingThreadIds.has(entry.threadId)).map(
      featuredRow,
    );
    const payload = FeaturedReplaysSchema.parse({ data });
    createLogger().debug("replay_featured_listed", { count: payload.data.length });
    return Response.json(payload, { headers: { "Cache-Control": REPLAY_CACHE_CONTROL } });
  } finally {
    ctx.waitUntil(close());
  }
}

/**
 * `GET /v1/replays/:id` — unauthenticated. `:id` is a manifest slug. Validates
 * the slug format pre-DB (400 `invalid_path_param`), resolves it to a curated
 * thread, reads the whole sanitized timeline, and returns it. Unknown slug,
 * missing/empty thread, and soft-deleted thread/project all collapse to a
 * uniform 404 `not_found_replay` — no oracle distinguishes the cases.
 */
export async function replayByIdRoute(
  env: ReplayRouteEnv,
  ctx: ExecutionContext,
  rawId: string,
): Promise<Response> {
  const slug = parseReplaySlug(rawId);
  const entry = FEATURED_REPLAYS.find((candidate) => candidate.id === slug);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const resolved = entry ? manifestReplay(entry) : await sharedReplay(db, slug);
    const rows = await listReplayMessages(db, {
      threadId: resolved.threadId,
      limit: REPLAY_MESSAGE_LIMIT,
    });
    const messages = sanitizedReplayMessages(rows);
    if (messages.length === 0) {
      throwReplayNotFound(slug, "empty_thread");
    }
    const payload = PublicReplaySchema.parse({
      messages,
      replay: {
        authorName: resolved.authorName,
        date: resolved.date ?? messages.at(-1)?.createdAt ?? null,
        id: slug,
        title: resolved.title,
      },
    });
    const body = JSON.stringify(payload);
    createLogger().info("replay_view", {
      id: slug,
      messageCount: payload.messages.length,
      payloadBytes: new TextEncoder().encode(body).byteLength,
      source: resolved.source,
    });
    return new Response(body, {
      headers: {
        // User shares can be revoked, so they are not edge-cached; manifest replays are.
        "Cache-Control": resolved.source === "manifest" ? REPLAY_CACHE_CONTROL : "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } finally {
    ctx.waitUntil(close());
  }
}

interface ResolvedReplay {
  authorName: string;
  date: string | null;
  source: "manifest" | "share";
  threadId: ThreadId;
  title: string;
}

function manifestReplay(entry: FeaturedReplayConfig): ResolvedReplay {
  return {
    authorName: entry.authorName ?? DEFAULT_AUTHOR_NAME,
    date: null,
    source: "manifest",
    threadId: ThreadId(entry.threadId),
    title: entry.title,
  };
}

/**
 * Resolves a user-published share token to its source thread. A revoked, private,
 * missing, or soft-deleted share collapses to the same uniform 404 as an unknown
 * manifest slug — no oracle distinguishes the cases.
 */
async function sharedReplay(db: Database, slug: string): Promise<ResolvedReplay> {
  const share = await findReplayShareById(db, slug);
  if (!share || share.revokedAt !== null || share.visibility === "private") {
    throwReplayNotFound(slug, "unknown_slug");
  }
  const existing = await listExistingThreadIds(db, { threadIds: [share.threadId] });
  if (existing.length === 0) {
    throwReplayNotFound(slug, "empty_thread");
  }
  return {
    authorName: share.authorName,
    date: share.createdAt.toISOString(),
    source: "share",
    threadId: share.threadId,
    title: share.title,
  };
}

function parseReplaySlug(rawId: string): string {
  const parsed = ReplaySlugSchema.safeParse(rawId);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", "Invalid replay id", {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  return parsed.data;
}

function featuredRow(entry: FeaturedReplayConfig): {
  accentKind?: FeaturedReplayConfig["accentKind"];
  id: string;
  previewText: string;
  title: string;
} {
  return {
    id: entry.id,
    previewText: entry.previewText,
    title: entry.title,
    ...(entry.accentKind ? { accentKind: entry.accentKind } : {}),
  };
}

function sanitizedReplayMessages(rows: MessageRecord[]): SanitizedReplayMessage[] {
  const messages: SanitizedReplayMessage[] = [];
  for (const row of rows) {
    const role = replayRole(row.role);
    if (!role) {
      continue;
    }
    messages.push({
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      parts: sanitizeReplayParts(row.parts),
      role,
    });
  }
  return messages;
}

/** Only `user`/`assistant` roles survive; `system`/`tool` are dropped entirely (replays plan §4.3). */
function replayRole(role: string): "assistant" | "user" | null {
  if (role === "assistant") {
    return "assistant";
  }
  if (role === "user") {
    return "user";
  }
  return null;
}

/** Logs the internal granularity, then throws the uniform 404 (replays plan §4.1, §8). */
function throwReplayNotFound(slug: string, reason: "empty_thread" | "unknown_slug"): never {
  createLogger().info("replay_not_found", { id: slug, reason });
  throw new APIError(404, "not_found_replay", "Replay not found", { retriable: false });
}
