import { toUserId, type UserId } from "@cheatcode/types";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  boundedLeaseLimit,
  createLeaseQueue,
  type DeferredLeaseQueueJob,
  type LeaseQueueDeferPolicy,
  type LeaseQueueLease,
  partitionLeaseClaims,
} from "./lease-queue";
import {
  type UserDeletionPhase,
  type UserDeletionStatus,
  userDeletionJobs,
  userDeletionRefundIntents,
  users,
} from "./schema";

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

export interface UserDeletionJobLease extends LeaseQueueLease {
  jobId: string;
  userId: UserId;
}

const userDeletionLeaseQueue = createLeaseQueue({
  identity: (lease: UserDeletionJobLease) => [
    eq(userDeletionJobs.id, lease.jobId),
    eq(userDeletionJobs.userId, lease.userId),
  ],
  leaseFromContinuation: (continuation, input) => ({
    continuation,
    jobId: input.jobId,
    leaseToken: input.nextLeaseToken,
    userId: input.userId,
  }),
  table: userDeletionJobs,
});

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

export interface DeferredUserDeletionJob
  extends DeferredLeaseQueueJob<Extract<UserDeletionStatus, "queued" | "quarantined">> {}

export async function discoverUserDeletionJobs(
  db: Database,
  input: { before: Date; limit?: number },
): Promise<number> {
  const limit = boundedLeaseLimit(input.limit);
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
      ${boundedLeaseLimit(input.limit)},
      ${Math.max(1, Math.trunc(input.maxFailures))},
      ${input.now ?? new Date()}
    )
  `);
  const claims = partitionLeaseClaims(result.rows);
  return {
    leases: claims.leased.map((row) => ({
      continuation: row.continuation,
      jobId: row.job_id,
      leaseToken: input.leaseToken,
      userId: toUserId(row.user_id),
    })),
    quarantinedJobIds: claims.quarantinedJobIds,
    stale: claims.stale,
  };
}

export async function renewAndLoadUserDeletionJob(
  db: Database,
  lease: UserDeletionJobLease,
): Promise<ClaimedUserDeletionJob> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(userDeletionJobs)
      .set(userDeletionLeaseQueue.renewalFields())
      .where(userDeletionLeaseQueue.claimIdentity(lease))
      .returning();
    if (!row) {
      return { state: "lost" };
    }
    if (!(await isDeletionGenerationCurrent(tx as Database, row))) {
      await tx.delete(userDeletionJobs).where(userDeletionLeaseQueue.claimIdentity(lease));
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
  const refundGuard =
    input.expectedPhase === "billing" && input.phase !== "billing"
      ? sql`not exists (
          select 1
            from ${userDeletionRefundIntents} refund_intent
           where refund_intent.job_id = ${userDeletionJobs.id}
             and refund_intent.provider_status is distinct from 'succeeded'
        )`
      : undefined;
  const progress = and(
    eq(userDeletionJobs.phase, input.expectedPhase),
    sql`${userDeletionJobs.cursor} is not distinct from ${input.expectedCursor}`,
    refundGuard,
  );
  return userDeletionLeaseQueue.advanceJob(
    db,
    input,
    progress,
    sql`cursor = ${input.cursor}, phase = ${input.phase}`,
  );
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

export const reserveUserDeletionContinuation = (
  db: Database,
  input: UserDeletionJobLease & { nextLeaseToken: string },
) => userDeletionLeaseQueue.reserveContinuation(db, input);

export const deferUserDeletionJob = (
  db: Database,
  input: UserDeletionJobLease & { errorCode: string },
  policy: LeaseQueueDeferPolicy<Extract<UserDeletionStatus, "queued" | "quarantined">>,
): Promise<DeferredUserDeletionJob | null> => userDeletionLeaseQueue.deferJob(db, input, policy);

export const quarantineUserDeletionJob = (
  db: Database,
  input: UserDeletionJobLease & { errorCode: string },
) => userDeletionLeaseQueue.quarantineJob(db, input);

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

function integerField(row: Record<string, unknown> | undefined, key: string): number {
  const value = Number(row?.[key] ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid user-deletion database count: ${key}`);
  }
  return value;
}
