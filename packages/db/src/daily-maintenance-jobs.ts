import { and, asc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { ActivationEventCursor } from "./activation";
import {
  deleteQuiescedArtifactUploadIntents,
  type QuiescedArtifactUploadIntentRecord,
} from "./artifact-upload-intents";
import type { Database } from "./client";
import { type DailyMaintenanceJobPhase, dailyMaintenanceJobs } from "./schema";

const LEASE_DURATION_MS = 2 * 60 * 60 * 1000;
const MAX_RECONCILIATION_CLAIMS = 25;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

type JobRow = typeof dailyMaintenanceJobs.$inferSelect;

export interface DailyMaintenanceJobLease {
  continuation: number;
  day: string;
  leaseToken: string;
  releaseVersionId: string;
}

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
       limit ${boundedLimit(input.limit)}
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
           lease_expires_at = ${leaseExpiry(now)},
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
    .limit(boundedLimit(input.limit));
  return rows.map(leaseFromRow);
}

export async function renewAndLoadDailyMaintenanceJob(
  db: Database,
  lease: DailyMaintenanceJobLease,
): Promise<ClaimedDailyMaintenanceJob> {
  const [row] = await db
    .update(dailyMaintenanceJobs)
    .set({ leaseExpiresAt: leaseExpiry(new Date()) })
    .where(claimIdentity(lease))
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
    .set({ leaseExpiresAt: leaseExpiry(new Date()) })
    .where(and(claimIdentity(input), progressIdentity(input.expected)))
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
  const rows = await db
    .update(dailyMaintenanceJobs)
    .set(progressUpdate(input.next))
    .where(and(claimIdentity(input), progressIdentity(input.expected)))
    .returning({ day: dailyMaintenanceJobs.day });
  return rows.length === 1;
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
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(dailyMaintenanceJobs)
      .set({
        continuation: sql`${dailyMaintenanceJobs.continuation} + 1`,
        leaseExpiresAt: leaseExpiry(new Date()),
        leaseToken: input.nextLeaseToken,
      })
      .where(and(claimIdentity(input), progressIdentity(input.expected)))
      .returning({
        continuation: dailyMaintenanceJobs.continuation,
        day: dailyMaintenanceJobs.day,
      });
    if (row) {
      return {
        ...row,
        leaseToken: input.nextLeaseToken,
        releaseVersionId: input.releaseVersionId,
      };
    }
    return loadReservedContinuation(tx as Database, input);
  });
}

async function loadReservedContinuation(
  db: Database,
  input: DailyMaintenanceJobLease & { nextLeaseToken: string },
): Promise<DailyMaintenanceJobLease | null> {
  const reserved = await db.query.dailyMaintenanceJobs.findFirst({
    columns: { continuation: true, day: true, leaseToken: true, releaseVersionId: true },
    where: and(
      eq(dailyMaintenanceJobs.day, input.day),
      eq(dailyMaintenanceJobs.continuation, input.continuation + 1),
      eq(dailyMaintenanceJobs.status, "leased"),
      eq(dailyMaintenanceJobs.leaseToken, input.nextLeaseToken),
      eq(dailyMaintenanceJobs.releaseVersionId, input.releaseVersionId),
    ),
  });
  return reserved ? leaseFromRow(reserved) : null;
}

/** Return a failed lease to cron admission with unbounded, operationally capped backoff. */
export async function deferDailyMaintenanceJob(
  db: Database,
  input: DailyMaintenanceJobLease & { errorCode: string },
): Promise<{ continuation: number; failureCount: number } | null> {
  return db.transaction(async (tx) => {
    const row = await tx.query.dailyMaintenanceJobs.findFirst({ where: claimIdentity(input) });
    if (!row) {
      return null;
    }
    const failureCount = row.failureCount + 1;
    const [updated] = await tx
      .update(dailyMaintenanceJobs)
      .set({
        continuation: row.continuation + 1,
        failureCount,
        lastErrorCode: input.errorCode.slice(0, 128),
        leaseExpiresAt: null,
        leaseToken: null,
        nextAttemptAt: new Date(Date.now() + retryDelayMs(failureCount)),
        releaseVersionId: null,
        status: "queued",
      })
      .where(claimIdentity(input))
      .returning({ continuation: dailyMaintenanceJobs.continuation });
    return updated ? { continuation: updated.continuation, failureCount } : null;
  });
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
      failureCount: 0,
      lastErrorCode: null,
      leaseExpiresAt: null,
      leaseToken: null,
      releaseVersionId: null,
      status: "complete",
    })
    .where(and(claimIdentity(input), progressIdentity(input.expected)))
    .returning({ day: dailyMaintenanceJobs.day });
  return rows.length === 1;
}

function progressUpdate(progress: DailyMaintenanceJobProgress) {
  return {
    activationCursorEvent: progress.activationCursor?.eventName ?? null,
    activationCursorUserId: progress.activationCursor?.userId ?? null,
    failureCount: 0,
    lastErrorCode: null,
    leaseExpiresAt: leaseExpiry(new Date()),
    phase: progress.phase,
  };
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

function nullableTextIdentity<TColumn>(column: TColumn, value: string | undefined) {
  const typedColumn = column as Parameters<typeof eq>[0];
  return value === undefined ? isNull(typedColumn) : eq(typedColumn, value);
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

function claimIdentity(lease: DailyMaintenanceJobLease) {
  return and(
    eq(dailyMaintenanceJobs.day, lease.day),
    eq(dailyMaintenanceJobs.continuation, lease.continuation),
    eq(dailyMaintenanceJobs.status, "leased"),
    eq(dailyMaintenanceJobs.leaseToken, lease.leaseToken),
    eq(dailyMaintenanceJobs.releaseVersionId, lease.releaseVersionId),
  );
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

function boundedLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(Math.trunc(limit ?? MAX_RECONCILIATION_CLAIMS), 25));
}

function leaseExpiry(now: Date): Date {
  return new Date(now.getTime() + LEASE_DURATION_MS);
}

function retryDelayMs(failureCount: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 30_000 * 2 ** Math.min(failureCount - 1, 10));
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
