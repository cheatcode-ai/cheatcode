import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v2TableName } from "./names";

export type RetentionJobPhase = "activation" | "cleanup";
export type RetentionJobStatus = "complete" | "leased" | "queued";

/** Durable, globally scoped progress for one UTC day's activation and output-retention chain. */
export const retentionJobs = pgTable(
  v2TableName("retention_jobs"),
  {
    day: date("day", { mode: "string" }).primaryKey(),
    scheduledAt: timestamp("scheduled_at", { precision: 3, withTimezone: true }).notNull(),
    phase: text("phase").$type<RetentionJobPhase>().notNull().default("activation"),
    activationCursorEvent: text("activation_cursor_event"),
    activationCursorUserId: uuid("activation_cursor_user_id"),
    continuation: integer("continuation").notNull().default(0),
    status: text("status").$type<RetentionJobStatus>().notNull().default("queued"),
    releaseVersionId: uuid("release_version_id"),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { precision: 3, withTimezone: true }),
    failureCount: integer("failure_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { precision: 3, withTimezone: true })
      .notNull()
      .defaultNow(),
    lastErrorCode: text("last_error_code"),
    completedAt: timestamp("completed_at", { precision: 3, withTimezone: true }),
  },
  (table) => [
    index("v2_retention_jobs_ready_idx")
      .on(table.nextAttemptAt, table.day)
      .where(sql`${table.status} = 'queued'`),
    index("v2_retention_jobs_lease_idx")
      .on(table.leaseExpiresAt, table.day)
      .where(sql`${table.status} = 'leased'`),
    index("v2_retention_jobs_completed_idx")
      .on(table.completedAt, table.day)
      .where(sql`${table.status} = 'complete'`),
    check(
      "v2_retention_jobs_day_check",
      sql`${table.day} = ((${table.scheduledAt} at time zone 'UTC')::date - 1)`,
    ),
    check("v2_retention_jobs_phase_check", sql`${table.phase} in ('activation', 'cleanup')`),
    check(
      "v2_retention_jobs_status_check",
      sql`${table.status} in ('queued', 'leased', 'complete')`,
    ),
    check(
      "v2_retention_jobs_counter_check",
      sql`${table.continuation} >= 0 and ${table.failureCount} >= 0`,
    ),
    check(
      "v2_retention_jobs_error_code_check",
      sql`${table.lastErrorCode} is null or octet_length(${table.lastErrorCode}) <= 128`,
    ),
    check(
      "v2_retention_jobs_activation_cursor_check",
      sql`(
        (${table.activationCursorEvent} is null and ${table.activationCursorUserId} is null)
        or
        (
          ${table.phase} = 'activation'
          and ${table.activationCursorEvent} in ('retention_d7', 'retention_d28', 'first_week_mau')
          and ${table.activationCursorUserId} is not null
        )
      )`,
    ),
    check(
      "v2_retention_jobs_phase_cursor_check",
      sql`(
        (${table.phase} = 'activation')
        or
        (${table.phase} = 'cleanup' and ${table.activationCursorEvent} is null and ${table.activationCursorUserId} is null)
      )`,
    ),
    check(
      "v2_retention_jobs_lease_check",
      sql`(
        (
          ${table.status} = 'leased'
          and ${table.releaseVersionId} is not null
          and ${table.leaseToken} is not null
          and ${table.leaseExpiresAt} is not null
          and ${table.completedAt} is null
        )
        or
        (
          ${table.status} = 'queued'
          and ${table.releaseVersionId} is null
          and ${table.leaseToken} is null
          and ${table.leaseExpiresAt} is null
          and ${table.completedAt} is null
        )
        or
        (
          ${table.status} = 'complete'
          and ${table.releaseVersionId} is null
          and ${table.leaseToken} is null
          and ${table.leaseExpiresAt} is null
          and ${table.completedAt} is not null
        )
      )`,
    ),
    check(
      "v2_retention_jobs_terminal_phase_check",
      sql`${table.status} <> 'complete' or ${table.phase} = 'cleanup'`,
    ),
  ],
);
