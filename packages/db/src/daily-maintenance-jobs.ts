import { and, asc, eq, gt, isNull, lt, type SQLWrapper, sql } from "drizzle-orm";
import type { ActivationEventCursor } from "./activation";
import {
  deleteQuiescedArtifactUploadIntents,
  type QuiescedArtifactUploadIntentRecord,
} from "./artifact-upload-intents";
import type { Database } from "./client";
import {
  boundedLeaseLimit,
  createLeaseQueue,
  type LeaseQueueDeferPolicy,
  type LeaseQueueLease,
} from "./lease-queue";
import { type DailyMaintenanceJobPhase, dailyMaintenanceJobs } from "./schema";

type JobRow = typeof dailyMaintenanceJobs.$inferSelect;

export interface DailyMaintenanceJobLease extends LeaseQueueLease {
  day: string;
  releaseVersionId: string;
}

const dailyMaintenanceLeaseQueue = createLeaseQueue({
  identity: (lease: DailyMaintenanceJobLease) => [
    eq(dailyMaintenanceJobs.day, lease.day),
    eq(dailyMaintenanceJobs.releaseVersionId, lease.releaseVersionId),
  ],
  leaseFromContinuation: (continuation, input) => ({
    continuation,
    day: input.day,
    leaseToken: input.nextLeaseToken,
    releaseVersionId: input.releaseVersionId,
  }),
  table: dailyMaintenanceJobs,
});

export interface DailyMaintenanceJobRecord extends DailyMaintenanceJobLease {
  activationCursor: ActivationEventCursor | null;
  phase: DailyMaintenanceJobPhase;
  scheduledAt: Date;
}

export type ClaimedDailyMaintenanceJob =
  | { job: DailyMaintenanceJobRecord; state: "active" }
  | { state: "lost" };

export interface DailyMaintenanceJobProgress {
  activationCursor: ActivationEventCursor | null;
  phase: DailyMaintenanceJobPhase;
}

export type OrphanUploadCleanupAdvanceResult =
  | { deletedRows: number; state: "advanced" }
  | { state: "lost" };

/** Register one idempotent UTC-day job; a retained completion row prevents duplicate daily work. */
export async function registerDailyMaintenanceJob(
  db: Database,
  input: { day: string; scheduledAt: Date },
): Promise<void> {
  await db
    .insert(dailyMaintenanceJobs)
    .values({ day: maintenanceDay(input.day), scheduledAt: input.scheduledAt })
    .onConflictDoNothing({ target: dailyMaintenanceJobs.day });
}

/** Claim queued jobs and expired leases while fencing every reclaimed Workflow generation. */
export async function claimReadyDailyMaintenanceJobs(
  db: Database,
  input: {
    leaseToken: string;
    limit?: number;
    now?: Date;
    releaseVersionId: string;
  },
): Promise<DailyMaintenanceJobLease[]> {
  const now = input.now ?? new Date();
  const result = await db.execute(sql`
    with candidates as (
      select job.day
        from public.v2_daily_maintenance_jobs job
       where (job.status = 'queued' and job.next_attempt_at <= ${now})
          or (job.status = 'leased' and job.lease_expires_at <= ${now})
       order by coalesce(job.lease_expires_at, job.next_attempt_at), job.day
       limit ${boundedLeaseLimit(input.limit)}
       for update skip locked
    )
    update public.v2_daily_maintenance_jobs job
       set continuation = case
             when job.status = 'leased' then job.continuation + 1
             else job.continuation
           end,
           failure_count = case
             when job.status = 'leased' then job.failure_count + 1
             else job.failure_count
           end,
           last_error_code = case
             when job.status = 'leased' then 'daily_maintenance_lease_expired'
             else job.last_error_code
           end,
           status = 'leased',
           release_version_id = ${input.releaseVersionId}::uuid,
           lease_token = ${input.leaseToken}::uuid,
           lease_expires_at = ${dailyMaintenanceLeaseQueue.expiryAt(now)},
           completed_at = null
      from candidates
     where job.day = candidates.day
    returning job.day::text, job.continuation, job.lease_token, job.release_version_id
  `);
  return result.rows.map(leaseFromRow);
}

/** List live leases so cron reconciliation can restart errored deterministic instances immediately. */
export async function listLiveDailyMaintenanceJobLeases(
  db: Database,
  input: { limit?: number; now?: Date } = {},
): Promise<DailyMaintenanceJobLease[]> {
  const rows = await db
    .select({
      continuation: dailyMaintenanceJobs.continuation,
      day: dailyMaintenanceJobs.day,
      leaseToken: dailyMaintenanceJobs.leaseToken,
      releaseVersionId: dailyMaintenanceJobs.releaseVersionId,
    })
    .from(dailyMaintenanceJobs)
    .where(
      and(
        eq(dailyMaintenanceJobs.status, "leased"),
        gt(dailyMaintenanceJobs.leaseExpiresAt, input.now ?? new Date()),
      ),
    )
    .orderBy(asc(dailyMaintenanceJobs.leaseExpiresAt), asc(dailyMaintenanceJobs.day))
    .limit(boundedLeaseLimit(input.limit));
  return rows.map(leaseFromRow);
}

export async function renewAndLoadDailyMaintenanceJob(
  db: Database,
  lease: DailyMaintenanceJobLease,
): Promise<ClaimedDailyMaintenanceJob> {
  const [row] = await db
    .update(dailyMaintenanceJobs)
    .set(dailyMaintenanceLeaseQueue.renewalFields())
    .where(dailyMaintenanceLeaseQueue.claimIdentity(lease))
    .returning();
  return row ? { job: jobRecord(row), state: "active" } : { state: "lost" };
}

/** Fence an external side effect against the lease's exact durable position. */
export async function guardDailyMaintenanceJobProgress(
  db: Database,
  input: DailyMaintenanceJobLease & { expected: DailyMaintenanceJobProgress },
): Promise<boolean> {
  const rows = await db
    .update(dailyMaintenanceJobs)
    .set(dailyMaintenanceLeaseQueue.renewalFields())
    .where(and(dailyMaintenanceLeaseQueue.claimIdentity(input), progressIdentity(input.expected)))
    .returning({ day: dailyMaintenanceJobs.day });
  return rows.length === 1;
}

/** Compare-and-swap one page's phase and keyset cursor without allowing regression. */
export async function advanceDailyMaintenanceJob(
  db: Database,
  input: DailyMaintenanceJobLease & {
    expected: DailyMaintenanceJobProgress;
    next: DailyMaintenanceJobProgress;
  },
): Promise<boolean> {
  const next = input.next.activationCursor;
  return dailyMaintenanceLeaseQueue.advanceJob(
    db,
    input,
    progressIdentity(input.expected),
    sql`
      activation_cursor_event = ${next?.eventName ?? null},
      activation_cursor_user_id = ${next?.userId ?? null},
      phase = ${input.next.phase}
    `,
  );
}

/** Remove quiesced intent rows after R2 deletion and renew the same phase atomically. */
export async function deleteQuiescedArtifactIntentsAndAdvanceDailyMaintenanceJob(
  db: Database,
  input: DailyMaintenanceJobLease & {
    before: Date;
    expected: DailyMaintenanceJobProgress;
    intents: QuiescedArtifactUploadIntentRecord[];
    next: DailyMaintenanceJobProgress;
  },
): Promise<OrphanUploadCleanupAdvanceResult> {
  return db.transaction(async (transaction) => {
    const tx = transaction as Database;
    const advanced = await advanceDailyMaintenanceJob(tx, input);
    if (!advanced) {
      return { state: "lost" };
    }
    const deletedRows = await deleteQuiescedArtifactUploadIntents(tx, {
      before: input.before,
      intents: input.intents,
    });
    return { deletedRows, state: "advanced" };
  });
}

/** Atomically rotate the fenced lease before creating the deterministic continuation instance. */
export async function reserveDailyMaintenanceContinuation(
  db: Database,
  input: DailyMaintenanceJobLease & {
    expected: DailyMaintenanceJobProgress;
    nextLeaseToken: string;
  },
): Promise<DailyMaintenanceJobLease | null> {
  return dailyMaintenanceLeaseQueue.reserveContinuation(db, input, {
    claimIdentity: (lease: DailyMaintenanceJobLease) =>
      and(dailyMaintenanceLeaseQueue.claimIdentity(lease), progressIdentity(input.expected)),
    reservedIdentity: (lease: DailyMaintenanceJobLease) =>
      dailyMaintenanceLeaseQueue.claimIdentity(lease),
  });
}

/** Return a failed lease to cron admission with unbounded, operationally capped backoff. */
export async function deferDailyMaintenanceJob(
  db: Database,
  input: DailyMaintenanceJobLease & { errorCode: string },
  policy: LeaseQueueDeferPolicy<"queued">,
): Promise<{ continuation: number; failureCount: number } | null> {
  const deferred = await dailyMaintenanceLeaseQueue.deferJob(
    db,
    input,
    policy,
    sql`release_version_id = null`,
  );
  return deferred
    ? { continuation: deferred.continuation, failureCount: deferred.failureCount }
    : null;
}

/** Terminalize exactly one fenced chain while retaining a short idempotency tombstone. */
export async function completeDailyMaintenanceJob(
  db: Database,
  input: DailyMaintenanceJobLease & { expected: DailyMaintenanceJobProgress },
): Promise<boolean> {
  const rows = await db
    .update(dailyMaintenanceJobs)
    .set({
      activationCursorEvent: null,
      activationCursorUserId: null,
      completedAt: new Date(),
      ...dailyMaintenanceLeaseQueue.completionFields(),
      releaseVersionId: null,
      status: "complete",
    })
    .where(and(dailyMaintenanceLeaseQueue.claimIdentity(input), progressIdentity(input.expected)))
    .returning({ day: dailyMaintenanceJobs.day });
  return rows.length === 1;
}

function progressIdentity(progress: DailyMaintenanceJobProgress) {
  return and(
    eq(dailyMaintenanceJobs.phase, progress.phase),
    nullableTextIdentity(
      dailyMaintenanceJobs.activationCursorEvent,
      progress.activationCursor?.eventName,
    ),
    nullableTextIdentity(
      dailyMaintenanceJobs.activationCursorUserId,
      progress.activationCursor?.userId,
    ),
  );
}

function nullableTextIdentity(column: SQLWrapper, value: string | undefined) {
  return value === undefined ? isNull(column) : sql`${column} = ${value}`;
}

/** Bound completion tombstones without allowing a same-day delivery to recreate finished work. */
export async function purgeCompletedDailyMaintenanceJobs(
  db: Database,
  before: Date,
): Promise<number> {
  const rows = await db
    .delete(dailyMaintenanceJobs)
    .where(
      and(
        eq(dailyMaintenanceJobs.status, "complete"),
        lt(dailyMaintenanceJobs.completedAt, before),
      ),
    )
    .returning({ day: dailyMaintenanceJobs.day });
  return rows.length;
}

function jobRecord(row: JobRow): DailyMaintenanceJobRecord {
  const lease = leaseFromRow(row);
  return {
    ...lease,
    activationCursor:
      row.activationCursorEvent && row.activationCursorUserId
        ? {
            eventName: activationEventName(row.activationCursorEvent),
            userId: row.activationCursorUserId,
          }
        : null,
    phase: row.phase,
    scheduledAt: row.scheduledAt,
  };
}

function leaseFromRow(row: Record<string, unknown>): DailyMaintenanceJobLease {
  return {
    continuation: integerField(row, "continuation"),
    day: maintenanceDay(stringField(row, "day")),
    leaseToken: uuidField(row, "lease_token", "leaseToken"),
    releaseVersionId: uuidField(row, "release_version_id", "releaseVersionId"),
  };
}

function activationEventName(value: string): ActivationEventCursor["eventName"] {
  if (value === "retention_d7" || value === "retention_d28" || value === "first_week_mau") {
    return value;
  }
  throw new Error("Daily maintenance activation cursor event is invalid");
}

function maintenanceDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error("Daily maintenance job day must be YYYY-MM-DD");
  }
  return value;
}

function stringField(row: Record<string, unknown>, snake: string): string {
  const value = row[snake];
  if (typeof value !== "string") {
    throw new Error(`Daily maintenance job field ${snake} is missing`);
  }
  return value;
}

function integerField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Daily maintenance job field ${key} is invalid`);
  }
  return value;
}

function uuidField(row: Record<string, unknown>, snake: string, camel: string): string {
  const value = row[snake] ?? row[camel];
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw new Error(`Daily maintenance job field ${snake} is not a UUID`);
  }
  return value.toLowerCase();
}
