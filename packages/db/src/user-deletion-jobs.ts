import { UserId as toUserId, type UserId } from "@cheatcode/types";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  type UserDeletionPhase,
  type UserDeletionStatus,
  userDeletionJobs,
  userDeletionRefundIntents,
  users,
} from "./schema";

const LEASE_DURATION_MS = 2 * 60 * 60 * 1000;
const MAX_RECONCILIATION_CLAIMS = 25;
const REPEATABLE_USER_DELETION_PHASES = new Set<UserDeletionPhase>([
  "runs",
  "billing",
  "integrations",
  "objects",
]);
const NEXT_USER_DELETION_PHASE: Partial<Record<UserDeletionPhase, UserDeletionPhase>> = {
  archive: "finalize",
  billing: "quota",
  integrations: "objects",
  objects: "archive",
  quota: "integrations",
  runs: "sandbox",
  sandbox: "billing",
};

type JobRow = typeof userDeletionJobs.$inferSelect;

export interface UserDeletionJobLease {
  continuation: number;
  jobId: string;
  leaseToken: string;
  userId: UserId;
}

export interface UserDeletionJobRecord extends UserDeletionJobLease {
  cursor: string | null;
  deletionFence: string;
  generation: Date;
  phase: UserDeletionPhase;
}

export type ClaimedUserDeletionJob =
  | { job: UserDeletionJobRecord; state: "active" }
  | { state: "lost" | "stale" };

export interface UserDeletionClaimResult {
  leases: UserDeletionJobLease[];
  quarantinedJobIds: string[];
  stale: number;
}

export interface DeferredUserDeletionJob {
  continuation: number;
  failureCount: number;
  status: Extract<UserDeletionStatus, "queued" | "quarantined">;
}

export async function discoverUserDeletionJobs(
  db: Database,
  input: { before: Date; limit?: number },
): Promise<number> {
  const limit = boundedLimit(input.limit);
  const result = await db.execute(sql`
    select public.webhooks_discover_user_deletion_jobs(${input.before}, ${limit}) as discovered
  `);
  return integerField(result.rows[0], "discovered");
}

export async function claimReadyUserDeletionJobs(
  db: Database,
  input: { leaseToken: string; limit?: number; maxFailures: number; now?: Date },
): Promise<UserDeletionClaimResult> {
  const result = await db.execute(sql`
    select * from public.webhooks_claim_ready_user_deletion_jobs(
      ${input.leaseToken}::uuid,
      ${boundedLimit(input.limit)},
      ${Math.max(1, Math.trunc(input.maxFailures))},
      ${input.now ?? new Date()}
    )
  `);
  return claimedJobs(
    result.rows as Array<{
      continuation: number;
      disposition: "leased" | "quarantined" | "stale";
      job_id: string;
      user_id: string;
    }>,
    input.leaseToken,
  );
}

function claimedJobs(
  rows: Array<{
    continuation: number;
    disposition: "leased" | "quarantined" | "stale";
    job_id: string;
    user_id: string;
  }>,
  leaseToken: string,
): UserDeletionClaimResult {
  return {
    leases: rows
      .filter((row) => row.disposition === "leased")
      .map((row) => ({
        continuation: row.continuation,
        jobId: row.job_id,
        leaseToken,
        userId: toUserId(row.user_id),
      })),
    quarantinedJobIds: rows
      .filter((row) => row.disposition === "quarantined")
      .map((row) => row.job_id),
    stale: rows.filter((row) => row.disposition === "stale").length,
  };
}

export async function renewAndLoadUserDeletionJob(
  db: Database,
  lease: UserDeletionJobLease,
): Promise<ClaimedUserDeletionJob> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(userDeletionJobs)
      .set({ leaseExpiresAt: leaseExpiry(new Date()) })
      .where(claimIdentity(lease))
      .returning();
    if (!row) {
      return { state: "lost" };
    }
    if (!(await isDeletionGenerationCurrent(tx as Database, row))) {
      await tx.delete(userDeletionJobs).where(claimIdentity(lease));
      return { state: "stale" };
    }
    return { job: jobRecord(row), state: "active" };
  });
}

export async function advanceUserDeletionJob(
  db: Database,
  input: UserDeletionJobLease & {
    cursor: string | null;
    expectedCursor: string | null;
    expectedPhase: UserDeletionPhase;
    phase: UserDeletionPhase;
  },
): Promise<boolean> {
  assertValidPhaseTransition(input.expectedPhase, input.phase);
  const rows = await db
    .update(userDeletionJobs)
    .set({
      cursor: input.cursor,
      failureCount: 0,
      lastErrorCode: null,
      leaseExpiresAt: leaseExpiry(new Date()),
      phase: input.phase,
    })
    .where(
      and(
        claimIdentity(input),
        eq(userDeletionJobs.phase, input.expectedPhase),
        sql`${userDeletionJobs.cursor} is not distinct from ${input.expectedCursor}`,
        input.expectedPhase === "billing" && input.phase !== "billing"
          ? sql`not exists (
              select 1
                from ${userDeletionRefundIntents} refund_intent
               where refund_intent.job_id = ${userDeletionJobs.id}
                 and refund_intent.provider_status is distinct from 'succeeded'
            )`
          : undefined,
      ),
    )
    .returning({ id: userDeletionJobs.id });
  return rows.length === 1;
}

function assertValidPhaseTransition(
  expectedPhase: UserDeletionPhase,
  phase: UserDeletionPhase,
): void {
  if (phase === expectedPhase) {
    if (REPEATABLE_USER_DELETION_PHASES.has(phase)) {
      return;
    }
    throw new Error(`User-deletion phase cannot repeat: ${phase}`);
  }
  if (NEXT_USER_DELETION_PHASE[expectedPhase] !== phase) {
    throw new Error(`Invalid user-deletion phase transition: ${expectedPhase} -> ${phase}`);
  }
}

export async function reserveUserDeletionContinuation(
  db: Database,
  input: UserDeletionJobLease & { nextLeaseToken: string },
): Promise<UserDeletionJobLease | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(userDeletionJobs)
      .set({
        continuation: sql`${userDeletionJobs.continuation} + 1`,
        leaseExpiresAt: leaseExpiry(new Date()),
        leaseToken: input.nextLeaseToken,
      })
      .where(claimIdentity(input))
      .returning({ continuation: userDeletionJobs.continuation, jobId: userDeletionJobs.id });
    if (row) {
      return { ...row, leaseToken: input.nextLeaseToken, userId: input.userId };
    }
    return loadReservedContinuation(tx as Database, input);
  });
}

async function loadReservedContinuation(
  db: Database,
  input: UserDeletionJobLease & { nextLeaseToken: string },
): Promise<UserDeletionJobLease | null> {
  const reserved = await db.query.userDeletionJobs.findFirst({
    columns: { continuation: true, id: true, leaseToken: true },
    where: and(
      eq(userDeletionJobs.id, input.jobId),
      eq(userDeletionJobs.userId, input.userId),
      eq(userDeletionJobs.continuation, input.continuation + 1),
      eq(userDeletionJobs.status, "leased"),
      eq(userDeletionJobs.leaseToken, input.nextLeaseToken),
    ),
  });
  return reserved?.leaseToken
    ? {
        continuation: reserved.continuation,
        jobId: reserved.id,
        leaseToken: reserved.leaseToken,
        userId: input.userId,
      }
    : null;
}

export async function deferUserDeletionJob(
  db: Database,
  input: UserDeletionJobLease & { errorCode: string; maxFailures: number },
): Promise<DeferredUserDeletionJob | null> {
  return db.transaction(async (tx) => {
    const row = await tx.query.userDeletionJobs.findFirst({ where: claimIdentity(input) });
    if (!row) {
      return null;
    }
    const failureCount = row.failureCount + 1;
    const status = failureCount >= input.maxFailures ? "quarantined" : "queued";
    const [updated] = await tx
      .update(userDeletionJobs)
      .set({
        continuation: row.continuation + 1,
        failureCount,
        lastErrorCode: input.errorCode,
        leaseExpiresAt: null,
        leaseToken: null,
        nextAttemptAt: new Date(Date.now() + deletionRetryDelayMs(failureCount)),
        status,
      })
      .where(claimIdentity(input))
      .returning({ continuation: userDeletionJobs.continuation });
    return updated ? { continuation: updated.continuation, failureCount, status } : null;
  });
}

export async function quarantineUserDeletionJob(
  db: Database,
  input: UserDeletionJobLease & { errorCode: string },
): Promise<boolean> {
  const rows = await db
    .update(userDeletionJobs)
    .set({
      failureCount: sql`${userDeletionJobs.failureCount} + 1`,
      lastErrorCode: input.errorCode,
      leaseExpiresAt: null,
      leaseToken: null,
      status: "quarantined",
    })
    .where(claimIdentity(input))
    .returning({ id: userDeletionJobs.id });
  return rows.length === 1;
}

function claimIdentity(lease: UserDeletionJobLease) {
  return and(
    eq(userDeletionJobs.id, lease.jobId),
    eq(userDeletionJobs.userId, lease.userId),
    eq(userDeletionJobs.continuation, lease.continuation),
    eq(userDeletionJobs.status, "leased"),
    eq(userDeletionJobs.leaseToken, lease.leaseToken),
  );
}

async function isDeletionGenerationCurrent(db: Database, row: JobRow): Promise<boolean> {
  const appUser = await db.query.users.findFirst({
    columns: { deletedAt: true, deletionFence: true },
    where: eq(users.id, row.userId),
  });
  return (
    appUser?.deletedAt?.getTime() === row.generation.getTime() &&
    appUser.deletionFence === deletionFence(row.generation)
  );
}

function jobRecord(row: JobRow): UserDeletionJobRecord {
  if (!row.leaseToken) {
    throw new Error("A loaded user-deletion job must hold a lease");
  }
  return {
    continuation: row.continuation,
    cursor: row.cursor,
    deletionFence: deletionFence(row.generation),
    generation: row.generation,
    jobId: row.id,
    leaseToken: row.leaseToken,
    phase: row.phase,
    userId: toUserId(row.userId),
  };
}

function deletionFence(generation: Date): string {
  return String(generation.getTime());
}

function boundedLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(Math.trunc(limit ?? MAX_RECONCILIATION_CLAIMS), 25));
}

function leaseExpiry(now: Date): Date {
  return new Date(now.getTime() + LEASE_DURATION_MS);
}

function deletionRetryDelayMs(failureCount: number): number {
  return Math.min(6 * 60 * 60 * 1000, 30_000 * 2 ** Math.min(failureCount - 1, 10));
}

function integerField(row: Record<string, unknown> | undefined, key: string): number {
  const value = Number(row?.[key] ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid user-deletion database count: ${key}`);
  }
  return value;
}
