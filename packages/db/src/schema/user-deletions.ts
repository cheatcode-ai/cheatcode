import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export type UserDeletionPhase =
  | "runs"
  | "sandbox"
  | "billing"
  | "quota"
  | "integrations"
  | "objects"
  | "archive"
  | "finalize";
export type UserDeletionStatus = "queued" | "leased" | "quarantined";

/**
 * Durable progress for one irreversible account-deletion generation. Workflow
 * instances lease and advance this aggregate in bounded chunks; deleting the user
 * cascades the terminal job row in the same transaction as finalization.
 */
export const userDeletionJobs = pgTable(
  v2TableName("user_deletion_jobs"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    generation: timestamp("generation", { withTimezone: true }).notNull(),
    phase: text("phase").$type<UserDeletionPhase>().notNull().default("runs"),
    cursor: text("cursor"),
    continuation: integer("continuation").notNull().default(0),
    status: text("status").$type<UserDeletionStatus>().notNull().default("queued"),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { precision: 3, withTimezone: true }),
    failureCount: integer("failure_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { precision: 3, withTimezone: true })
      .notNull()
      .defaultNow(),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    unique("v2_user_deletion_jobs_id_user_generation_key").on(
      table.id,
      table.userId,
      table.generation,
    ),
    uniqueIndex("v2_user_deletion_jobs_generation_uidx").on(table.userId, table.generation),
    index("v2_user_deletion_jobs_ready_idx")
      .on(table.nextAttemptAt, table.id)
      .where(sql`${table.status} = 'queued'`),
    index("v2_user_deletion_jobs_lease_idx")
      .on(table.leaseExpiresAt, table.id)
      .where(sql`${table.status} = 'leased'`),
    check(
      "v2_user_deletion_jobs_phase_check",
      sql`${table.phase} in ('runs', 'sandbox', 'billing', 'quota', 'integrations', 'objects', 'archive', 'finalize')`,
    ),
    check(
      "v2_user_deletion_jobs_status_check",
      sql`${table.status} in ('queued', 'leased', 'quarantined')`,
    ),
    check(
      "v2_user_deletion_jobs_counter_check",
      sql`${table.continuation} >= 0 and ${table.failureCount} >= 0`,
    ),
    check(
      "v2_user_deletion_jobs_lease_check",
      sql`(
        (${table.status} = 'leased' and ${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null)
        or
        (${table.status} <> 'leased' and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null)
      )`,
    ),
  ],
);
