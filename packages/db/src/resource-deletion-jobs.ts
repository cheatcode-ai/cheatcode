import {
  type InternalResourceDeletionRequest,
  type ProjectId,
  type ThreadId,
  ProjectId as toProjectId,
  ThreadId as toThreadId,
  UserId as toUserId,
  type UserId,
} from "@cheatcode/types";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  isResourceDeletionGenerationCurrent,
  ResourceDeletionInvariantError,
  type ResourceDeletionScope,
} from "./project-deletion";
import {
  projects,
  type ResourceDeletionKind,
  type ResourceDeletionPhase,
  resourceDeletionJobs,
  threads,
  users,
} from "./schema";

const LEASE_DURATION_MS = 2 * 60 * 60 * 1000;
const MAX_RECONCILIATION_CLAIMS = 25;

type JobRow = typeof resourceDeletionJobs.$inferSelect;

interface ResourceDeletionJobProgress {
  cursor: string | null;
  generation: Date;
  kind: ResourceDeletionKind;
  phase: ResourceDeletionPhase;
  resourceId: string;
}

export interface ResourceDeletionJobRecord
  extends ResourceDeletionJobLease,
    ResourceDeletionJobProgress {
  projectId: ProjectId | null;
  threadId: ThreadId | null;
  workspaceSlug: string | null;
}

export interface ResourceDeletionJobLease {
  continuation: number;
  jobId: string;
  leaseToken: string;
  userId: UserId;
}

export interface ResourceDeletionJobGuard
  extends ResourceDeletionJobLease,
    Pick<ResourceDeletionJobProgress, "generation" | "kind" | "resourceId"> {
  expectedCursor: string | null;
  expectedPhase: ResourceDeletionPhase;
}

export type ClaimedResourceDeletionJob =
  | { job: ResourceDeletionJobRecord; state: "active" }
  | { state: "lost" | "stale" };

export interface ResourceDeletionDiscoveryResult {
  projects: number;
  threads: number;
}

export interface ResourceDeletionClaimResult {
  leases: ResourceDeletionJobLease[];
  quarantinedJobIds: string[];
}

export interface DeferredResourceDeletionJob {
  continuation: number;
  failureCount: number;
  status: "queued" | "quarantined";
}

export async function registerResourceDeletionJob(
  db: Database,
  request: InternalResourceDeletionRequest,
): Promise<JobRow | null> {
  const scope = requestScope(request);
  if (!(await isResourceDeletionGenerationCurrent(db, scope))) {
    return null;
  }
  const resourceId = request.kind === "project-deletion" ? request.projectId : request.threadId;
  const values = {
    generation: new Date(request.deletedAt),
    kind: request.kind,
    resourceId,
    userId: request.userId,
  } as const;
  const [inserted] = await db
    .insert(resourceDeletionJobs)
    .values(values)
    .onConflictDoNothing({
      target: [
        resourceDeletionJobs.kind,
        resourceDeletionJobs.resourceId,
        resourceDeletionJobs.generation,
      ],
    })
    .returning();
  if (inserted) {
    return inserted;
  }
  return (
    (await db.query.resourceDeletionJobs.findFirst({
      where: and(
        eq(resourceDeletionJobs.kind, request.kind),
        eq(resourceDeletionJobs.resourceId, resourceId),
        eq(resourceDeletionJobs.generation, new Date(request.deletedAt)),
        eq(resourceDeletionJobs.userId, request.userId),
      ),
    })) ?? null
  );
}

export async function discoverResourceDeletionJobs(
  db: Database,
  limit = MAX_RECONCILIATION_CLAIMS,
): Promise<ResourceDeletionDiscoveryResult> {
  const pageSize = Math.max(1, Math.min(Math.trunc(limit), MAX_RECONCILIATION_CLAIMS));
  const result = await db.execute(
    sql`select * from public.webhooks_discover_resource_deletion_jobs(${pageSize})`,
  );
  const row = result.rows[0];
  return {
    projects: integerField(row, "projects"),
    threads: integerField(row, "threads"),
  };
}

export async function claimReadyResourceDeletionJobs(
  db: Database,
  input: { leaseToken: string; limit?: number; maxFailures: number; now?: Date },
): Promise<ResourceDeletionClaimResult> {
  const leaseToken = input.leaseToken;
  const result = await db.execute(sql`
    select * from public.webhooks_claim_ready_resource_deletion_jobs(
      ${leaseToken}::uuid,
      ${Math.max(1, Math.min(input.limit ?? MAX_RECONCILIATION_CLAIMS, 25))},
      ${Math.max(1, Math.trunc(input.maxFailures))},
      ${input.now ?? new Date()}
    )
  `);
  const rows = result.rows as Array<{
    continuation: number;
    disposition: "leased" | "quarantined";
    job_id: string;
    user_id: string;
  }>;
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
  };
}

export async function claimResourceDeletionJobById(
  db: Database,
  input: { jobId: string; leaseToken: string; now?: Date; userId: UserId },
): Promise<ResourceDeletionJobLease | null> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    if (!(await deletionMaintenanceAvailable(tx as Database))) {
      return null;
    }
    const [job] = await tx
      .update(resourceDeletionJobs)
      .set({
        leaseExpiresAt: leaseExpiry(now),
        leaseToken: input.leaseToken,
        status: "leased",
      })
      .where(
        and(
          eq(resourceDeletionJobs.id, input.jobId),
          eq(resourceDeletionJobs.userId, input.userId),
          eq(resourceDeletionJobs.status, "queued"),
          lte(resourceDeletionJobs.nextAttemptAt, now),
        ),
      )
      .returning({
        continuation: resourceDeletionJobs.continuation,
        jobId: resourceDeletionJobs.id,
      });
    return job ? { ...job, leaseToken: input.leaseToken, userId: input.userId } : null;
  });
}

export async function renewAndLoadResourceDeletionJob(
  db: Database,
  lease: ResourceDeletionJobLease,
): Promise<ClaimedResourceDeletionJob> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(resourceDeletionJobs)
      .set({ leaseExpiresAt: leaseExpiry(new Date()) })
      .where(claimIdentity(lease))
      .returning();
    if (!row) {
      return { state: "lost" };
    }
    const context = await loadResourceContext(tx as Database, row);
    if (!context) {
      await tx.delete(resourceDeletionJobs).where(claimIdentity(lease));
      return { state: "stale" };
    }
    return { job: context, state: "active" };
  });
}

/** Renews only when the lease, resource generation, phase, and cursor are still exact. */
export async function guardResourceDeletionJobProgress(
  db: Database,
  input: ResourceDeletionJobGuard,
): Promise<boolean> {
  return db.transaction((transaction) =>
    renewCurrentResourceDeletionProgress(transaction as Database, input),
  );
}

/** Runs a database mutation under the same exact progress lock used by external steps. */
export async function runResourceDeletionJobDatabaseAction<Result>(
  db: Database,
  input: ResourceDeletionJobGuard,
  operation: (db: Database) => Promise<Result>,
): Promise<Result | null> {
  return db.transaction(async (transaction) => {
    const tx = transaction as Database;
    if (!(await renewCurrentResourceDeletionProgress(tx, input))) {
      return null;
    }
    return operation(tx);
  });
}

export async function advanceResourceDeletionJob(
  db: Database,
  input: ResourceDeletionJobGuard & { cursor: string | null; phase: ResourceDeletionPhase },
): Promise<boolean> {
  assertValidResourceDeletionTransition(input);
  return db.transaction(async (transaction) => {
    const tx = transaction as Database;
    if (!(await renewCurrentResourceDeletionProgress(tx, input))) {
      return false;
    }
    const rows = await tx
      .update(resourceDeletionJobs)
      .set({
        cursor: input.cursor,
        failureCount: 0,
        lastErrorCode: null,
        leaseExpiresAt: leaseExpiry(new Date()),
        phase: input.phase,
      })
      .where(and(claimIdentity(input), progressIdentity(input)))
      .returning({ id: resourceDeletionJobs.id });
    return rows.length === 1;
  });
}

export async function reserveResourceDeletionContinuation(
  db: Database,
  input: ResourceDeletionJobLease & { nextLeaseToken: string },
): Promise<ResourceDeletionJobLease | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(resourceDeletionJobs)
      .set({
        continuation: sql`${resourceDeletionJobs.continuation} + 1`,
        leaseExpiresAt: leaseExpiry(new Date()),
        leaseToken: input.nextLeaseToken,
      })
      .where(claimIdentity(input))
      .returning({
        continuation: resourceDeletionJobs.continuation,
        jobId: resourceDeletionJobs.id,
      });
    if (row) {
      return {
        ...row,
        leaseToken: input.nextLeaseToken,
        userId: input.userId,
      };
    }
    const reserved = await tx.query.resourceDeletionJobs.findFirst({
      columns: { continuation: true, id: true, leaseToken: true },
      where: and(
        eq(resourceDeletionJobs.id, input.jobId),
        eq(resourceDeletionJobs.userId, input.userId),
        eq(resourceDeletionJobs.continuation, input.continuation + 1),
        eq(resourceDeletionJobs.status, "leased"),
        eq(resourceDeletionJobs.leaseToken, input.nextLeaseToken),
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
  });
}

export async function deferResourceDeletionJob(
  db: Database,
  input: ResourceDeletionJobLease & {
    errorCode: string;
    maxFailures: number;
  },
): Promise<DeferredResourceDeletionJob | null> {
  return db.transaction(async (tx) => {
    const row = await tx.query.resourceDeletionJobs.findFirst({
      where: claimIdentity(input),
    });
    if (!row) {
      return null;
    }
    const failureCount = row.failureCount + 1;
    const status = failureCount >= input.maxFailures ? "quarantined" : "queued";
    const nextAttemptAt = new Date(Date.now() + deletionRetryDelayMs(failureCount));
    const [updated] = await tx
      .update(resourceDeletionJobs)
      .set({
        continuation: row.continuation + 1,
        failureCount,
        lastErrorCode: input.errorCode,
        leaseExpiresAt: null,
        leaseToken: null,
        nextAttemptAt,
        status,
      })
      .where(claimIdentity(input))
      .returning({ continuation: resourceDeletionJobs.continuation });
    return updated ? { continuation: updated.continuation, failureCount, status } : null;
  });
}

export async function quarantineResourceDeletionJob(
  db: Database,
  input: ResourceDeletionJobLease & { errorCode: string },
): Promise<boolean> {
  const rows = await db
    .update(resourceDeletionJobs)
    .set({
      failureCount: sql`${resourceDeletionJobs.failureCount} + 1`,
      lastErrorCode: input.errorCode,
      leaseExpiresAt: null,
      leaseToken: null,
      status: "quarantined",
    })
    .where(claimIdentity(input))
    .returning({ id: resourceDeletionJobs.id });
  return rows.length === 1;
}

export async function completeResourceDeletionJob(
  db: Database,
  input: ResourceDeletionJobGuard,
): Promise<boolean> {
  const rows = await db
    .delete(resourceDeletionJobs)
    .where(and(claimIdentity(input), progressIdentity(input)))
    .returning({ id: resourceDeletionJobs.id });
  return rows.length === 1;
}

async function renewCurrentResourceDeletionProgress(
  db: Database,
  input: ResourceDeletionJobGuard,
): Promise<boolean> {
  const [row] = await db
    .update(resourceDeletionJobs)
    .set({ leaseExpiresAt: leaseExpiry(new Date()) })
    .where(and(claimIdentity(input), progressIdentity(input)))
    .returning();
  if (!row) {
    return false;
  }
  if (await loadResourceContext(db, row)) {
    return true;
  }
  await db.delete(resourceDeletionJobs).where(and(claimIdentity(input), progressIdentity(input)));
  return false;
}

function progressIdentity(input: ResourceDeletionJobGuard) {
  return and(
    eq(resourceDeletionJobs.kind, input.kind),
    eq(resourceDeletionJobs.resourceId, input.resourceId),
    eq(resourceDeletionJobs.generation, input.generation),
    eq(resourceDeletionJobs.phase, input.expectedPhase),
    input.expectedCursor === null
      ? isNull(resourceDeletionJobs.cursor)
      : eq(resourceDeletionJobs.cursor, input.expectedCursor),
  );
}

function assertValidResourceDeletionTransition(
  input: ResourceDeletionJobGuard & { cursor: string | null; phase: ResourceDeletionPhase },
): void {
  const isValid =
    input.kind === "project-deletion"
      ? isValidProjectDeletionTransition(input)
      : isValidThreadDeletionTransition(input);
  if (!isValid) {
    throw new ResourceDeletionInvariantError(
      `Invalid ${input.kind} transition: ${input.expectedPhase} -> ${input.phase}`,
    );
  }
}

function isValidProjectDeletionTransition(
  input: ResourceDeletionJobGuard & { cursor: string | null; phase: ResourceDeletionPhase },
): boolean {
  switch (input.expectedPhase) {
    case "runs":
      return input.phase === "runs"
        ? cursorAdvances(input.expectedCursor, input.cursor)
        : input.phase === "workspace" && input.cursor === null;
    case "workspace":
      return noCursorTransition(input, "outputs");
    case "outputs":
      return input.phase === "outputs"
        ? cursorAdvances(input.expectedCursor, input.cursor)
        : input.phase === "prefix" && input.cursor === null;
    case "prefix":
      return (
        input.expectedCursor === null &&
        input.cursor === null &&
        (input.phase === "prefix" || input.phase === "pointer")
      );
    case "pointer":
      return noCursorTransition(input, "finalize");
    default:
      return false;
  }
}

function isValidThreadDeletionTransition(
  input: ResourceDeletionJobGuard & { cursor: string | null; phase: ResourceDeletionPhase },
): boolean {
  switch (input.expectedPhase) {
    case "runs":
      if (input.phase === "runs" || input.phase === "run-objects") {
        return cursorAdvances(input.expectedCursor, input.cursor);
      }
      return input.phase === "outputs" && input.cursor === null;
    case "run-objects":
      return (
        input.expectedCursor !== null &&
        input.cursor === input.expectedCursor &&
        (input.phase === "run-objects" || input.phase === "runs")
      );
    case "outputs":
      return input.phase === "outputs"
        ? cursorAdvances(input.expectedCursor, input.cursor)
        : input.phase === "pointer" && input.cursor === null;
    case "pointer":
      return noCursorTransition(input, "finalize");
    default:
      return false;
  }
}

function noCursorTransition(
  input: ResourceDeletionJobGuard & { cursor: string | null; phase: ResourceDeletionPhase },
  phase: ResourceDeletionPhase,
): boolean {
  return input.expectedCursor === null && input.cursor === null && input.phase === phase;
}

function cursorAdvances(expected: string | null, next: string | null): boolean {
  return next !== null && (expected === null || next > expected);
}

/** Prevents deletion claims from racing a production migration. */
async function deletionMaintenanceAvailable(db: Database): Promise<boolean> {
  const result = await db.execute(sql`
    select pg_try_advisory_xact_lock(
      hashtextextended('cheatcode:database-maintenance:v1', 0)
    ) as acquired
  `);
  return result.rows[0]?.["acquired"] === true;
}

function claimIdentity(lease: ResourceDeletionJobLease) {
  return and(
    eq(resourceDeletionJobs.id, lease.jobId),
    eq(resourceDeletionJobs.userId, lease.userId),
    eq(resourceDeletionJobs.continuation, lease.continuation),
    eq(resourceDeletionJobs.status, "leased"),
    eq(resourceDeletionJobs.leaseToken, lease.leaseToken),
  );
}

async function loadResourceContext(
  db: Database,
  row: JobRow,
): Promise<ResourceDeletionJobRecord | null> {
  const appUser = await db.query.users.findFirst({
    columns: { deletedAt: true },
    where: eq(users.id, row.userId),
  });
  if (!appUser || appUser.deletedAt) {
    return null;
  }
  return row.kind === "project-deletion" ? loadProjectContext(db, row) : loadThreadContext(db, row);
}

async function loadProjectContext(
  db: Database,
  row: JobRow,
): Promise<ResourceDeletionJobRecord | null> {
  const project = await db.query.projects.findFirst({
    columns: { deletedAt: true, workspaceSlug: true },
    where: and(eq(projects.id, row.resourceId), eq(projects.userId, row.userId)),
  });
  if (!project || project.deletedAt?.getTime() !== row.generation.getTime()) {
    return null;
  }
  return jobRecord(row, {
    projectId: toProjectId(row.resourceId),
    threadId: null,
    workspaceSlug: project.workspaceSlug,
  });
}

async function loadThreadContext(
  db: Database,
  row: JobRow,
): Promise<ResourceDeletionJobRecord | null> {
  const thread = await db.query.threads.findFirst({
    columns: { deletedAt: true, projectId: true },
    where: and(eq(threads.id, row.resourceId), eq(threads.userId, row.userId)),
  });
  if (!thread || thread.deletedAt?.getTime() !== row.generation.getTime()) {
    return null;
  }
  if (thread.projectId && (await parentProjectDeleting(db, thread.projectId, row.userId))) {
    return null;
  }
  return jobRecord(row, {
    projectId: thread.projectId ? toProjectId(thread.projectId) : null,
    threadId: toThreadId(row.resourceId),
    workspaceSlug: null,
  });
}

async function parentProjectDeleting(
  db: Database,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const project = await db.query.projects.findFirst({
    columns: { deletedAt: true },
    where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
  });
  return Boolean(project?.deletedAt);
}

function jobRecord(
  row: JobRow,
  context: Pick<ResourceDeletionJobRecord, "projectId" | "threadId" | "workspaceSlug">,
): ResourceDeletionJobRecord {
  if (!row.leaseToken) {
    throw new Error("A loaded deletion job must hold a lease");
  }
  return {
    continuation: row.continuation,
    cursor: row.cursor,
    generation: row.generation,
    jobId: row.id,
    kind: row.kind,
    leaseToken: row.leaseToken,
    phase: row.phase,
    resourceId: row.resourceId,
    userId: toUserId(row.userId),
    ...context,
  };
}

function requestScope(request: InternalResourceDeletionRequest): ResourceDeletionScope {
  const deletedAt = new Date(request.deletedAt);
  const userId = toUserId(request.userId);
  return request.kind === "project-deletion"
    ? { deletedAt, kind: request.kind, projectId: toProjectId(request.projectId), userId }
    : { deletedAt, kind: request.kind, threadId: toThreadId(request.threadId), userId };
}

function leaseExpiry(now: Date): Date {
  return new Date(now.getTime() + LEASE_DURATION_MS);
}

function deletionRetryDelayMs(failureCount: number): number {
  return Math.min(6 * 60 * 60 * 1000, 30_000 * 2 ** Math.min(failureCount - 1, 10));
}

function integerField(row: Record<string, unknown> | undefined, key: string): number {
  const value = row?.[key];
  return typeof value === "number" && Number.isInteger(value) ? value : Number(value ?? 0);
}
