import {
  claimReadyRetentionJobs,
  createDb,
  type Database,
  deferRetentionJob,
  listLiveRetentionJobLeases,
  purgeCompletedRetentionJobs,
  type RetentionJobLease,
  registerDailyRetentionJob,
} from "@cheatcode/db";
import { createLogger, emitErrorEvent, safeErrorTelemetry } from "@cheatcode/observability";
import { z } from "zod";
import { assertReleaseOpen } from "./release-gate";
import {
  activeRetentionReleaseVersion,
  createRetentionInstance,
  previousUtcDay,
  type RetentionMaintenanceEnv,
} from "./retention-maintenance";
import type { DeterministicWorkflowResult } from "./workflow-instance";

const RETENTION_RECONCILIATION_LIMIT = 25;
const RETENTION_CREATION_CONCURRENCY = 5;
const RETENTION_TOMBSTONE_MS = 32 * 24 * 60 * 60 * 1000;
const CREATION_ERROR_CODE = "retention_instance_creation_failed";
const ORPHANED_COMPLETION_ERROR_CODE = "retention_instance_completed_without_job_completion";
const ScheduledTimeSchema = z.number().int().nonnegative().max(8_640_000_000_000_000);

type ReconciliationSource = "claimed" | "live";

interface ReconciliationCandidate {
  lease: RetentionJobLease;
  source: ReconciliationSource;
}

export interface RetentionReconciliationSummary {
  claimed: number;
  created: number;
  deferred: number;
  purged: number;
  restarted: number;
  reused: number;
  staleRelease: number;
}

/** Register a daily job, then use the same recovery path as the five-minute reconciler. */
export async function enqueueDailyRetentionMetrics(
  env: RetentionMaintenanceEnv,
  scheduledTimeInput: number,
): Promise<RetentionReconciliationSummary> {
  assertReleaseOpen(env);
  const scheduledAt = new Date(ScheduledTimeSchema.parse(scheduledTimeInput));
  await withDatabase(env, (db) =>
    registerDailyRetentionJob(db, { day: previousUtcDay(scheduledAt), scheduledAt }),
  );
  return reconcileDailyRetentionWorkflows(env);
}

/** Recreate live reserved generations and lease every due/expired day in bounded batches. */
export async function reconcileDailyRetentionWorkflows(
  env: RetentionMaintenanceEnv,
): Promise<RetentionReconciliationSummary> {
  assertReleaseOpen(env);
  const releaseVersionId = activeRetentionReleaseVersion(env);
  const now = new Date();
  const state = await loadReconciliationState(env, now, releaseVersionId);
  const eligibleLive = state.live.filter((lease) => lease.releaseVersionId === releaseVersionId);
  const candidates = [
    ...eligibleLive.map((lease): ReconciliationCandidate => ({ lease, source: "live" })),
    ...state.claimed.map((lease): ReconciliationCandidate => ({ lease, source: "claimed" })),
  ];
  const creation = await createReconciledInstances(env, candidates);
  return {
    ...creation,
    claimed: state.claimed.length,
    purged: state.purged,
    staleRelease: state.live.length - eligibleLive.length,
  };
}

async function loadReconciliationState(
  env: RetentionMaintenanceEnv,
  now: Date,
  releaseVersionId: string,
): Promise<{ claimed: RetentionJobLease[]; live: RetentionJobLease[]; purged: number }> {
  return withDatabase(env, async (db) => {
    const purged = await purgeCompletedRetentionJobs(
      db,
      new Date(now.getTime() - RETENTION_TOMBSTONE_MS),
    );
    const live = await listLiveRetentionJobLeases(db, {
      limit: RETENTION_RECONCILIATION_LIMIT,
      now,
    });
    const claimed = await claimReadyRetentionJobs(db, {
      leaseToken: crypto.randomUUID(),
      limit: RETENTION_RECONCILIATION_LIMIT,
      now,
      releaseVersionId,
    });
    return { claimed, live, purged };
  });
}

async function createReconciledInstances(
  env: RetentionMaintenanceEnv,
  candidates: ReconciliationCandidate[],
): Promise<Omit<RetentionReconciliationSummary, "claimed" | "purged" | "staleRelease">> {
  const summary = { created: 0, deferred: 0, restarted: 0, reused: 0 };
  for (let offset = 0; offset < candidates.length; offset += RETENTION_CREATION_CONCURRENCY) {
    const batch = candidates.slice(offset, offset + RETENTION_CREATION_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(({ lease }) => createRetentionInstance(env, lease)),
    );
    await accountForReconciliationBatch(env, batch, settled, summary);
  }
  return summary;
}

async function accountForReconciliationBatch(
  env: RetentionMaintenanceEnv,
  candidates: ReconciliationCandidate[],
  settled: PromiseSettledResult<DeterministicWorkflowResult>[],
  summary: { created: number; deferred: number; restarted: number; reused: number },
): Promise<void> {
  for (const [index, result] of settled.entries()) {
    const candidate = candidates[index];
    if (!candidate) {
      throw new Error("Retention reconciliation lost a lease identity");
    }
    if (result.status === "rejected") {
      await accountForCreationFailure(env, candidate, result.reason, summary);
      continue;
    }
    await accountForCreationResult(env, candidate, result.value, summary);
  }
}

async function accountForCreationFailure(
  env: RetentionMaintenanceEnv,
  candidate: ReconciliationCandidate,
  error: unknown,
  summary: { deferred: number },
): Promise<void> {
  if (candidate.source === "claimed") {
    const deferred = await tryDeferLease(env, candidate.lease, CREATION_ERROR_CODE);
    summary.deferred += deferred ? 1 : 0;
  }
  createLogger().error("retention_instance_reconciliation_failed", {
    continuation: candidate.lease.continuation,
    day: candidate.lease.day,
    source: candidate.source,
    ...safeErrorTelemetry(error),
  });
  emitErrorEvent(env, {
    errorCategory: "workflow",
    errorCode: CREATION_ERROR_CODE,
    route: "retention-admission",
    workerName: "webhooks",
  });
}

async function accountForCreationResult(
  env: RetentionMaintenanceEnv,
  candidate: ReconciliationCandidate,
  result: DeterministicWorkflowResult,
  summary: { created: number; deferred: number; restarted: number; reused: number },
): Promise<void> {
  summary.created += result.reused ? 0 : 1;
  summary.reused += result.reused ? 1 : 0;
  summary.restarted += result.status === "errored" || result.status === "terminated" ? 1 : 0;
  if (result.status === "complete") {
    const deferred = await tryDeferLease(env, candidate.lease, ORPHANED_COMPLETION_ERROR_CODE);
    summary.deferred += deferred ? 1 : 0;
  }
}

async function tryDeferLease(
  env: RetentionMaintenanceEnv,
  lease: RetentionJobLease,
  errorCode: string,
): Promise<boolean> {
  try {
    const deferred = await withDatabase(env, (db) =>
      deferRetentionJob(db, { ...lease, errorCode }),
    );
    return deferred !== null;
  } catch (error) {
    createLogger().error("retention_reconciliation_defer_failed", {
      continuation: lease.continuation,
      day: lease.day,
      errorCode,
      ...safeErrorTelemetry(error),
    });
    return false;
  }
}

async function withDatabase<T>(
  env: RetentionMaintenanceEnv,
  operation: (db: Database) => Promise<T>,
): Promise<T> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_webhooks",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS,
  });
  try {
    return await operation(db);
  } finally {
    await close();
  }
}
