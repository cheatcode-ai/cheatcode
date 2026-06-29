import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { threads } from "./projects";
import { users } from "./users";

/**
 * User-generated replay shares: a caller publishes one of their own runs (a thread)
 * as a read-only, link-shareable replay. The row `id` IS the public share token
 * (random uuidv7, unguessable, matches the public replay slug format). `title` and
 * `authorName` are snapshotted at share time so the unauthenticated public read path
 * needs no cross-user thread/profile lookup. `revokedAt`/`visibility` gate access;
 * the thread FK cascades, so deleting the source run also removes the share.
 */
export const replayShares = pgTable(
  v2TableName("replay_shares"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    // private | unlisted | public — read is allowed for unlisted/public while revokedAt is null.
    visibility: text("visibility").notNull().default("unlisted"),
    title: text("title").notNull(),
    authorName: text("author_name").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("v2_replay_shares_user_idx").on(table.userId),
    // At most one active (non-revoked) share per thread, so re-sharing is idempotent.
    uniqueIndex("v2_replay_shares_thread_active_idx")
      .on(table.threadId)
      .where(sql`revoked_at is null`),
  ],
);
