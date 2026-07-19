import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export type ResourceDeletionKind = "project-deletion" | "thread-deletion";
export type ResourceDeletionPhase =
  | "runs"
  | "run-objects"
  | "workspace"
  | "outputs"
  | "prefix"
  | "pointer"
  | "finalize";
export type ResourceDeletionStatus = "queued" | "leased" | "quarantined";

/**
 * Durable orchestration state for destructive project/thread cleanup. A short Workflow
 * instance leases one row, advances a bounded chunk, then hands the row to a continuation.
 */
export const resourceDeletionJobs = pgTable(
  v2TableName("resource_deletion_jobs"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ResourceDeletionKind>().notNull(),
    resourceId: uuid("resource_id").notNull(),
    generation: timestamp("generation", { precision: 3, withTimezone: true }).notNull(),
    phase: text("phase").$type<ResourceDeletionPhase>().notNull().default("runs"),
    cursor: uuid("cursor"),
    continuation: integer("continuation").notNull().default(0),
    status: text("status").$type<ResourceDeletionStatus>().notNull().default("queued"),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { precision: 3, withTimezone: true }),
    failureCount: integer("failure_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { precision: 3, withTimezone: true })
      .notNull()
      .defaultNow(),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    uniqueIndex("v2_resource_deletion_jobs_generation_uidx").on(
      table.kind,
      table.resourceId,
      table.generation,
    ),
    index("v2_resource_deletion_jobs_user_idx").on(table.userId),
    index("v2_resource_deletion_jobs_ready_idx")
      .on(table.nextAttemptAt, table.id)
      .where(sql`status = 'queued'`),
    index("v2_resource_deletion_jobs_lease_idx")
      .on(table.leaseExpiresAt, table.id)
      .where(sql`status = 'leased'`),
    check(
      "v2_resource_deletion_jobs_kind_check",
      sql`${table.kind} in ('project-deletion', 'thread-deletion')`,
    ),
    check(
      "v2_resource_deletion_jobs_phase_check",
      sql`${table.phase} in ('runs', 'run-objects', 'workspace', 'outputs', 'prefix', 'pointer', 'finalize')`,
    ),
    check(
      "v2_resource_deletion_jobs_status_check",
      sql`${table.status} in ('queued', 'leased', 'quarantined')`,
    ),
    check(
      "v2_resource_deletion_jobs_counter_check",
      sql`${table.continuation} >= 0 and ${table.failureCount} >= 0`,
    ),
    check(
      "v2_resource_deletion_jobs_lease_check",
      sql`(
        (${table.status} = 'leased' and ${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null)
        or
        (${table.status} <> 'leased' and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null)
      )`,
    ),
  ],
);
