import type { ThreadId } from "@cheatcode/types";
import { ThreadId as toThreadId } from "@cheatcode/types";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "./client";
import { type MessageRecord, messageFromRow } from "./projects";
import { messages, projects, threads } from "./schema";

/** Hard ceiling on a replay transcript length (replays plan §2.2). */
const REPLAY_MESSAGE_LIMIT = 200;

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
