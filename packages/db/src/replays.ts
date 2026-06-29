import type { ThreadId, UserId } from "@cheatcode/types";
import { ThreadId as toThreadId, UserId as toUserId } from "@cheatcode/types";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "./client";
import { type MessageRecord, messageFromRow } from "./projects";
import { messages, projects, replayShares, threads } from "./schema";

/** Hard ceiling on a replay transcript length (replays plan §2.2). */
const REPLAY_MESSAGE_LIMIT = 200;

/** One user-published replay share. `id` is the public, unguessable share token. */
export interface ReplayShareRecord {
  id: string;
  userId: UserId;
  threadId: ThreadId;
  visibility: string;
  title: string;
  authorName: string;
  revokedAt: Date | null;
  createdAt: Date;
}

function replayShareFromRow(row: {
  id: string;
  userId: string;
  threadId: string;
  visibility: string;
  title: string;
  authorName: string;
  revokedAt: Date | null;
  createdAt: Date;
}): ReplayShareRecord {
  return {
    authorName: row.authorName,
    createdAt: row.createdAt,
    id: row.id,
    revokedAt: row.revokedAt,
    threadId: toThreadId(row.threadId),
    title: row.title,
    userId: toUserId(row.userId),
    visibility: row.visibility,
  };
}

const REPLAY_SHARE_COLUMNS = {
  authorName: replayShares.authorName,
  createdAt: replayShares.createdAt,
  id: replayShares.id,
  revokedAt: replayShares.revokedAt,
  threadId: replayShares.threadId,
  title: replayShares.title,
  userId: replayShares.userId,
  visibility: replayShares.visibility,
} as const;

/**
 * Get-or-create the active share for one of the caller's threads (idempotent: the
 * partial-unique index keeps at most one non-revoked share per thread). Runs inside
 * `withUserContext`; the caller must have already verified thread ownership.
 */
export async function upsertReplayShare(
  db: Database,
  input: {
    userId: UserId;
    threadId: ThreadId;
    title: string;
    authorName: string;
  },
): Promise<ReplayShareRecord> {
  const existing = await db
    .select(REPLAY_SHARE_COLUMNS)
    .from(replayShares)
    .where(
      and(
        eq(replayShares.threadId, input.threadId),
        eq(replayShares.userId, input.userId),
        isNull(replayShares.revokedAt),
      ),
    )
    .limit(1);
  const current = existing[0];
  if (current) {
    return replayShareFromRow(current);
  }
  const rows = await db
    .insert(replayShares)
    .values({
      authorName: input.authorName,
      threadId: input.threadId,
      title: input.title,
      userId: input.userId,
    })
    .returning(REPLAY_SHARE_COLUMNS);
  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create replay share");
  }
  return replayShareFromRow(row);
}

/**
 * Returns the caller's active (non-revoked) share for one of their threads, or null.
 * Runs inside `withUserContext`; lets the share dialog show an existing link + revoke
 * instead of always offering "create".
 */
export async function findActiveReplayShareByThread(
  db: Database,
  input: { userId: UserId; threadId: ThreadId },
): Promise<ReplayShareRecord | null> {
  const rows = await db
    .select(REPLAY_SHARE_COLUMNS)
    .from(replayShares)
    .where(
      and(
        eq(replayShares.threadId, input.threadId),
        eq(replayShares.userId, input.userId),
        isNull(replayShares.revokedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? replayShareFromRow(row) : null;
}

/**
 * Public read lookup by share token — NO user filter (a share grants public access).
 * Returns the row even when revoked/private so the route applies the access policy
 * and a uniform 404. Reuses the operator-replay convention of bypassing user scope.
 */
export async function findReplayShareById(
  db: Database,
  id: string,
): Promise<ReplayShareRecord | null> {
  const rows = await db
    .select(REPLAY_SHARE_COLUMNS)
    .from(replayShares)
    .where(eq(replayShares.id, id))
    .limit(1);
  const row = rows[0];
  return row ? replayShareFromRow(row) : null;
}

/** Update visibility and/or revoke a share the caller owns. Runs inside `withUserContext`. */
export async function updateReplayShare(
  db: Database,
  input: {
    userId: UserId;
    id: string;
    visibility?: string;
    revoke?: boolean;
  },
): Promise<ReplayShareRecord | null> {
  const patch: {
    updatedAt: Date;
    visibility?: string;
    revokedAt?: Date | null;
  } = { updatedAt: new Date() };
  if (input.visibility !== undefined) {
    patch.visibility = input.visibility;
  }
  if (input.revoke !== undefined) {
    patch.revokedAt = input.revoke ? new Date() : null;
  }
  const rows = await db
    .update(replayShares)
    .set(patch)
    .where(and(eq(replayShares.id, input.id), eq(replayShares.userId, input.userId)))
    .returning(REPLAY_SHARE_COLUMNS);
  const row = rows[0];
  return row ? replayShareFromRow(row) : null;
}

/**
 * Reads the whole persisted timeline of one operator-curated demo thread,
 * oldest-first, capped at {@link REPLAY_MESSAGE_LIMIT}. Runs WITHOUT
 * `withUserContext` and WITHOUT a `user_id` filter: `v2_messages` has no RLS
 * and the thread is operator-vetted, so there is no per-user ownership to
 * enforce here. Returns `[]` when the thread is unseeded/empty so the route can
 * map it to a uniform 404. Reuses `messageFromRow`; the mapper is not duplicated.
 */
export async function listReplayMessages(
  db: Database,
  input: { threadId: ThreadId; limit?: number },
): Promise<MessageRecord[]> {
  const limit = Math.min(Math.max(input.limit ?? REPLAY_MESSAGE_LIMIT, 1), REPLAY_MESSAGE_LIMIT);
  const rows = await db.query.messages.findMany({
    columns: {
      agentRunId: true,
      createdAt: true,
      id: true,
      parts: true,
      role: true,
      threadId: true,
    },
    limit,
    orderBy: [asc(messages.createdAt)],
    where: eq(messages.threadId, input.threadId),
  });
  return rows.map(messageFromRow);
}

/**
 * Returns the subset of `input.threadIds` whose thread AND owning project are
 * both still live (neither soft-deleted). One indexed `IN` join; used by the
 * featured-replay route to drop manifest entries that no longer resolve in the
 * current environment (non-prod, or a later-deleted demo thread).
 */
export async function listExistingThreadIds(
  db: Database,
  input: { threadIds: ThreadId[] },
): Promise<ThreadId[]> {
  if (input.threadIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ id: threads.id })
    .from(threads)
    .innerJoin(projects, and(eq(projects.id, threads.projectId), isNull(projects.deletedAt)))
    .where(and(inArray(threads.id, input.threadIds), isNull(threads.deletedAt)));
  return rows.map((row) => toThreadId(row.id));
}
