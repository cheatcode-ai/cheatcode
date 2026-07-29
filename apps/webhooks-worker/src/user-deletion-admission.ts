import {
  claimReadyUserDeletionJobs,
  deferUserDeletionJob,
  discoverUserDeletionJobs,
  type HyperdriveConnection,
  type UserDeletionJobLease,
} from "@cheatcode/db";
import type { CloudflareVersionMetadata, WorkerSecret } from "@cheatcode/env";
import {
  type AnalyticsBindings,
  createLogger,
  emitErrorEvent,
  safeErrorTelemetry,
} from "@cheatcode/observability";
import { z } from "zod";
import { withDatabase, withUserDatabase } from "./deletion-job-runner";
import {
  DELETION_JOB_DEFER_POLICY,
  MAX_TRANSIENT_DELETION_FAILURES,
} from "./lifecycle/deletion-job-policy";
import { createDeterministicWorkflow, type DeterministicWorkflowResult } from "./workflow-instance";

const ProductionReleaseShaSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const ProductionReleaseVersionIdSchema = z.string().uuid();
const ReleaseVersionIdSchema = z.union([
  ProductionReleaseVersionIdSchema,
  z.literal("development"),
]);

export const UserDeletionPayloadSchema = z
  .object({
    continuation: z.number().int().nonnegative().max(2_147_483_647),
    jobId: z.string().uuid(),
    kind: z.literal("user-deletion"),
    leaseToken: z.string().uuid(),
    releaseVersionId: ReleaseVersionIdSchema,
    userId: z.string().uuid(),
  })
  .strict();
export type UserDeletionPayload = z.infer<typeof UserDeletionPayloadSchema>;

export interface UserDeletionWorkflowBindings {
  USER_DELETION_WORKFLOW: Workflow<UserDeletionPayload>;
}

export interface UserDeletionAdmissionEnv extends AnalyticsBindings, UserDeletionWorkflowBindings {
  CF_VERSION_METADATA?: CloudflareVersionMetadata;
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CHEATCODE_RELEASE_SHA?: string;
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
  HYPERDRIVE: HyperdriveConnection;
}

const USER_DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const USER_DELETION_RECONCILIATION_LIMIT = 25;
const USER_DELETION_CREATION_CONCURRENCY = 10;
const CREATION_ERROR_CODE = "user_deletion_instance_creation_failed";

export interface UserDeletionAdmissionSummary {
  claimed: number;
  created: number;
  deferred: number;
  discovered: number;
  quarantined: number;
  releaseSha: string;
  releaseVersionId: string;
  restarted: number;
  reused: number;
  stale: number;
}

/** Discovers and leases only deletions whose durable grace deadline has elapsed. */
export async function admitDueUserDeletionWorkflows(
  env: UserDeletionAdmissionEnv,
  scheduledTime: number,
): Promise<UserDeletionAdmissionSummary> {
  const release = activeUserDeletionRelease(env);
  const reconciliation = await reconcileDeletionJobs(env, scheduledTime);
  const creation = await createClaimedInstances(
    env,
    reconciliation.leases,
    release.releaseVersionId,
  );
  emitClaimQuarantines(env, reconciliation.quarantinedJobIds);
  return {
    ...creation,
    claimed: reconciliation.leases.length,
    discovered: reconciliation.discovered,
    quarantined: reconciliation.quarantinedJobIds.length + creation.quarantined,
    releaseSha: release.releaseSha,
    releaseVersionId: release.releaseVersionId,
    stale: reconciliation.stale,
  };
}

async function reconcileDeletionJobs(
  env: UserDeletionAdmissionEnv,
  scheduledTime: number,
): Promise<{
  discovered: number;
  leases: UserDeletionJobLease[];
  quarantinedJobIds: string[];
  stale: number;
}> {
  return withDatabase(env, async (db) => {
    const discovered = await discoverUserDeletionJobs(db, {
      before: new Date(scheduledTime - USER_DELETION_GRACE_MS),
      limit: USER_DELETION_RECONCILIATION_LIMIT,
    });
    const claimed = await claimReadyUserDeletionJobs(db, {
      leaseToken: crypto.randomUUID(),
      limit: USER_DELETION_RECONCILIATION_LIMIT,
      maxFailures: MAX_TRANSIENT_DELETION_FAILURES,
      now: new Date(scheduledTime),
    });
    return { discovered, ...claimed };
  });
}

interface CreationSummary {
  created: number;
  deferred: number;
  quarantined: number;
  restarted: number;
  reused: number;
}

async function createClaimedInstances(
  env: UserDeletionAdmissionEnv,
  leases: UserDeletionJobLease[],
  releaseVersionId: UserDeletionPayload["releaseVersionId"],
): Promise<CreationSummary> {
  const summary: CreationSummary = {
    created: 0,
    deferred: 0,
    quarantined: 0,
    restarted: 0,
    reused: 0,
  };
  for (let offset = 0; offset < leases.length; offset += USER_DELETION_CREATION_CONCURRENCY) {
    const batch = leases.slice(offset, offset + USER_DELETION_CREATION_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((lease) => createUserDeletionInstance(env, lease, releaseVersionId)),
    );
    await accountForCreationBatch(env, batch, settled, summary);
  }
  return summary;
}

async function accountForCreationBatch(
  env: UserDeletionAdmissionEnv,
  leases: UserDeletionJobLease[],
  settled: PromiseSettledResult<DeterministicWorkflowResult>[],
  summary: CreationSummary,
): Promise<void> {
  for (const [index, result] of settled.entries()) {
    const lease = leases[index];
    if (!lease) {
      throw new Error("User-deletion creation result lost its lease identity");
    }
    if (result.status === "fulfilled") {
      accountForCreatedInstance(result.value, summary);
      continue;
    }
    const status = await deferFailedCreation(env, lease, result.reason);
    summary.deferred += status ? 1 : 0;
    summary.quarantined += status === "quarantined" ? 1 : 0;
  }
}

function accountForCreatedInstance(
  result: DeterministicWorkflowResult,
  summary: CreationSummary,
): void {
  summary.created += result.reused ? 0 : 1;
  summary.reused += result.reused ? 1 : 0;
  summary.restarted += result.status === "errored" || result.status === "terminated" ? 1 : 0;
}

async function deferFailedCreation(
  env: UserDeletionAdmissionEnv,
  lease: UserDeletionJobLease,
  error: unknown,
): Promise<"queued" | "quarantined" | null> {
  const deferred = await withUserDatabase(env, lease.userId, (db) =>
    deferUserDeletionJob(
      db,
      { ...lease, errorCode: CREATION_ERROR_CODE },
      DELETION_JOB_DEFER_POLICY,
    ),
  );
  createLogger().error("user_deletion_instance_creation_deferred", {
    jobId: lease.jobId,
    status: deferred?.status ?? "lost",
    ...safeErrorTelemetry(error),
  });
  emitErrorEvent(env, {
    errorCategory: "lifecycle",
    errorCode: CREATION_ERROR_CODE,
    route: "user-deletion-admission",
    workerName: "webhooks",
  });
  return deferred?.status ?? null;
}

export async function createUserDeletionContinuation(
  env: UserDeletionAdmissionEnv,
  lease: UserDeletionJobLease,
  releaseVersionId: UserDeletionPayload["releaseVersionId"],
): Promise<DeterministicWorkflowResult> {
  return createUserDeletionInstance(env, lease, releaseVersionId);
}

function createUserDeletionInstance(
  env: UserDeletionAdmissionEnv,
  lease: UserDeletionJobLease,
  releaseVersionId: UserDeletionPayload["releaseVersionId"],
): Promise<DeterministicWorkflowResult> {
  const payload: UserDeletionPayload = {
    continuation: lease.continuation,
    jobId: lease.jobId,
    kind: "user-deletion",
    leaseToken: lease.leaseToken,
    releaseVersionId,
    userId: lease.userId,
  };
  return createDeterministicWorkflow(env.USER_DELETION_WORKFLOW, {
    id: userDeletionWorkflowId(payload),
    params: payload,
    retention: { errorRetention: "30 days", successRetention: "30 days" },
  });
}

interface UserDeletionRelease {
  releaseSha: string;
  releaseVersionId: UserDeletionPayload["releaseVersionId"];
}

function activeUserDeletionRelease(env: UserDeletionAdmissionEnv): UserDeletionRelease {
  if (env.CHEATCODE_ENVIRONMENT === "production") {
    return {
      releaseSha: ProductionReleaseShaSchema.parse(env.CHEATCODE_RELEASE_SHA),
      releaseVersionId: ProductionReleaseVersionIdSchema.parse(env.CF_VERSION_METADATA?.id),
    };
  }
  const releaseSha = ProductionReleaseShaSchema.safeParse(env.CHEATCODE_RELEASE_SHA);
  const releaseVersionId = ReleaseVersionIdSchema.safeParse(env.CF_VERSION_METADATA?.id);
  return {
    releaseSha: releaseSha.success ? releaseSha.data : "development",
    releaseVersionId: releaseVersionId.success ? releaseVersionId.data : "development",
  };
}

function userDeletionWorkflowId(payload: UserDeletionPayload): string {
  const id = `ud-${payload.releaseVersionId}-${payload.jobId}-${payload.continuation}`;
  if (id.length > 100) {
    throw new Error("User deletion Workflow identity exceeded Cloudflare's 100-character limit");
  }
  return id;
}

export function isUserDeletionWorkflowIdentity(
  instanceId: string,
  payload: UserDeletionPayload,
): boolean {
  return instanceId === userDeletionWorkflowId(payload);
}

function emitClaimQuarantines(env: UserDeletionAdmissionEnv, jobIds: string[]): void {
  for (const jobId of jobIds) {
    createLogger().error("user_deletion_quarantined", {
      errorCode: "user_deletion_lease_expired",
      jobId,
    });
    emitErrorEvent(env, {
      errorCategory: "lifecycle",
      errorCode: "user_deletion_quarantined",
      route: "user-deletion-admission",
      workerName: "webhooks",
    });
  }
}
