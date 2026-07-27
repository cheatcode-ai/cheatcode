import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  advanceResourceDeletionJob,
  claimReadyResourceDeletionJobs,
  claimResourceDeletionJobById,
  clearProjectDeletionRunPointers,
  clearThreadDeletionRunPointer,
  completeResourceDeletionJob,
  createDb,
  deferResourceDeletionJob,
  deleteResourceDeletionOutputRecords,
  discoverResourceDeletionJobs,
  finalizeProjectDeletion,
  finalizeThreadDeletion,
  type HyperdriveConnection,
  listProjectDeletionOutputs,
  listProjectDeletionRunIds,
  listThreadDeletionOutputs,
  listThreadDeletionRunIds,
  quarantineResourceDeletionJob,
  ResourceDeletionInvariantError,
  type ResourceDeletionJobLease,
  type ResourceDeletionJobRecord,
  registerResourceDeletionJob,
  renewAndLoadResourceDeletionJob,
  reserveResourceDeletionContinuation,
  withUserContext,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import { type AnalyticsBindings, createLogger } from "@cheatcode/observability";
import {
  AgentRunId,
  type InternalResourceDeletionRequest,
  type ResourceDeletionWorkflowPayload,
  ResourceDeletionWorkflowPayloadSchema,
  UserId,
} from "@cheatcode/types";
import { z } from "zod";
import {
  CREATE_STEP_OPTIONS,
  createDeletionJobRunner,
  type DeletionActionOutcome,
  type DeletionWorkflowOutcome,
  deletionErrorClassifier,
  MAX_TRANSIENT_DELETION_FAILURES,
  runDeletionActions,
} from "./deletion-job-runner";
import {
  type AgentStateDeletionEnv,
  deleteProjectAgentWorkspace,
  deleteR2ObjectPrefixBatch,
  deleteUserAgentRunStatePage,
} from "./lifecycle-adapters";
import {
  dbStep,
  deletionInvariant,
  deletionScope,
  exactJob,
  guardedDatabaseAction,
  guardedExternalStep,
  projectGeneration,
  requiredCursor,
  requiredProjectId,
  requiredThreadId,
  threadGeneration,
  withDatabase,
  withUserDatabase,
} from "./resource-deletion-action-support";
import {
  continuationLeaseToken,
  createResourceDeletionInstances,
  type ResourceDeletionWorkflowBindings,
} from "./resource-deletion-instances";
import { outputFromWireRecord, outputToWireRecord } from "./resource-deletion-output-records";

export type { ResourceDeletionWorkflowBindings } from "./resource-deletion-instances";

const OUTPUT_PAGE_SIZE = 50;
const PROJECT_RUN_PAGE_SIZE = 25;
const RunIdPageSchema = z.array(z.string().uuid()).max(PROJECT_RUN_PAGE_SIZE);
const OutputPageSchema = z
  .array(
    z
      .object({
        id: z.string().uuid(),
        recordType: z.enum(["generated-output", "upload-intent"]),
        r2Key: z.string().min(1),
      })
      .strict(),
  )
  .max(OUTPUT_PAGE_SIZE);

type ActionOutcome = DeletionActionOutcome;
type WorkflowOutcome = DeletionWorkflowOutcome;

export interface ResourceDeletionWorkflowEnv
  extends AnalyticsBindings,
    AgentStateDeletionEnv,
    ResourceDeletionWorkflowBindings {
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
  HYPERDRIVE: HyperdriveConnection;
  R2_OUTPUTS: R2Bucket;
}

type DeferredResourceDeletion = NonNullable<Awaited<ReturnType<typeof deferResourceDeletionJob>>>;

const RESOURCE_DELETION_RUNNER = createDeletionJobRunner<
  ResourceDeletionWorkflowEnv,
  ResourceDeletionJobLease,
  DeferredResourceDeletion
>({
  classify: deletionErrorClassifier({
    invalidStateCode: "resource_deletion_invalid_state",
    invariantCode: "resource_deletion_invariant",
    isInvariant: (error) => error instanceof ResourceDeletionInvariantError,
  }),
  defer: (env, step, lease, errorCode, label) =>
    dbStep(step, `${label} defer deletion`, () =>
      withUserDatabase(env, lease.userId, (db) =>
        deferResourceDeletionJob(db, {
          ...lease,
          errorCode,
          maxFailures: MAX_TRANSIENT_DELETION_FAILURES,
        }),
      ),
    ),
  onDeferred: (_env, lease, _error, errorCode, _label, deferred) => {
    if (deferred && deferred.status !== "quarantined") {
      createLogger().warn("resource_deletion_deferred", {
        errorCode,
        failureCount: deferred.failureCount,
        jobId: lease.jobId,
      });
    }
  },
  quarantine: {
    errorEventName: "resource_deletion_quarantined",
    errorRoute: "resource-deletion-workflow",
    failureName: "ResourceDeletionQuarantined",
    fallbackMessage: "Resource deletion quarantine termination failed",
    identity: (lease) => ({ jobId: lease.jobId }),
    logEventName: "resource_deletion_quarantined",
    message: (errorCode) => `Resource deletion quarantined (${errorCode})`,
    quarantine: (env, step, lease, errorCode, label) =>
      dbStep(step, `${label} quarantine deletion`, () =>
        withUserDatabase(env, lease.userId, (db) =>
          quarantineResourceDeletionJob(db, { ...lease, errorCode }),
        ),
      ),
    terminationStepName: (label) => `${label} terminate quarantined deletion`,
  },
});

export class ResourceDeletionWorkflow extends WorkflowEntrypoint<
  ResourceDeletionWorkflowEnv,
  ResourceDeletionWorkflowPayload
> {
  public override async run(
    event: Readonly<WorkflowEvent<ResourceDeletionWorkflowPayload>>,
    step: WorkflowStep,
  ): Promise<{ outcome: WorkflowOutcome }> {
    const parsed = ResourceDeletionWorkflowPayloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      throw new NonRetryableError(
        "Invalid resource deletion workflow payload",
        "ResourceDeletionPayloadError",
      );
    }
    try {
      return await processDeletionChunk(this.env, parsed.data, step);
    } catch (error) {
      return RESOURCE_DELETION_RUNNER.handleFailure(
        this.env,
        step,
        parsed.data,
        error,
        "execution",
      );
    }
  }
}

export async function enqueueResourceDeletionWorkflow(
  env: ResourceDeletionWorkflowEnv,
  request: InternalResourceDeletionRequest,
): Promise<string | null> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_webhooks",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS,
  });
  let lease: ResourceDeletionJobLease | null = null;
  let jobId: string | null = null;
  try {
    const userId = UserId(request.userId);
    const registered = await withUserContext(db, userId, async (tx) => {
      const job = await registerResourceDeletionJob(tx, request);
      const claimed = job
        ? await claimResourceDeletionJobById(tx, {
            jobId: job.id,
            leaseToken: crypto.randomUUID(),
            userId,
          })
        : null;
      return { jobId: job?.id ?? null, lease: claimed };
    });
    jobId = registered.jobId;
    lease = registered.lease;
  } finally {
    await close();
  }
  if (lease) {
    await createClaimedInstancesOrDefer(env, [lease]);
  }
  return jobId;
}

export async function reconcileResourceDeletionWorkflows(
  env: ResourceDeletionWorkflowEnv,
): Promise<{
  claimed: number;
  created: number;
  projects: number;
  quarantined: number;
  threads: number;
}> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_webhooks",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS,
  });
  let leases: ResourceDeletionJobLease[] = [];
  let projects = 0;
  let quarantinedJobIds: string[] = [];
  let threads = 0;
  try {
    const discovered = await discoverResourceDeletionJobs(db);
    projects = discovered.projects;
    threads = discovered.threads;
    const claimed = await claimReadyResourceDeletionJobs(db, {
      leaseToken: crypto.randomUUID(),
      limit: 25,
      maxFailures: MAX_TRANSIENT_DELETION_FAILURES,
    });
    leases = claimed.leases;
    quarantinedJobIds = claimed.quarantinedJobIds;
  } finally {
    await close();
  }
  for (const jobId of quarantinedJobIds) {
    RESOURCE_DELETION_RUNNER.reportQuarantine(
      env,
      { jobId },
      new Error("Resource deletion lease repeatedly expired"),
      "resource_deletion_lease_expired",
    );
  }
  const created = await createClaimedInstancesOrDefer(env, leases);
  return {
    claimed: leases.length,
    created,
    projects,
    quarantined: quarantinedJobIds.length,
    threads,
  };
}

async function processDeletionChunk(
  env: ResourceDeletionWorkflowEnv,
  lease: ResourceDeletionJobLease,
  step: WorkflowStep,
): Promise<{ outcome: WorkflowOutcome }> {
  return runDeletionActions({
    continueDeletion: () => continueDeletion(env, step, lease),
    load: async (action) => {
      const claimed = await dbStep(step, `revalidate deletion action ${action}`, () =>
        withUserDatabase(env, lease.userId, (db) => renewAndLoadResourceDeletionJob(db, lease)),
      );
      return claimed.state === "active" ? claimed.job : null;
    },
    process: (job, action) => processDeletionAction(env, step, job, action),
  });
}

async function processDeletionAction(
  env: ResourceDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ResourceDeletionJobRecord,
  action: number,
): Promise<ActionOutcome> {
  switch (job.phase) {
    case "runs":
      return processRuns(env, step, job, action);
    case "run-objects":
      return processRunObjects(env, step, job, action);
    case "workspace":
      return processWorkspace(env, step, job, action);
    case "outputs":
      return processOutputs(env, step, job, action);
    case "prefix":
      return processProjectPrefix(env, step, job, action);
    case "pointer":
      return processRunPointer(env, step, job, action);
    case "finalize":
      return processFinalizer(env, step, job, action);
  }
}

async function processRuns(
  env: ResourceDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ResourceDeletionJobRecord,
  action: number,
): Promise<ActionOutcome> {
  const runIds = await loadRunIds(env, step, job, action);
  if (runIds.length === 0) {
    const phase = job.kind === "project-deletion" ? "workspace" : "outputs";
    return advanceJob(env, step, job, action, phase, null);
  }
  const deleted = await guardedExternalStep(
    env,
    step,
    job,
    `delete run state action ${action}`,
    async () => {
      await deleteUserAgentRunStatePage(env, job.userId, runIds, agentRunDeletionAuthority(job));
      return true;
    },
  );
  if (!deleted) {
    return "noop";
  }
  const cursor = requiredCursor(runIds.at(-1), "run");
  const phase = job.kind === "thread-deletion" && job.projectId ? "run-objects" : "runs";
  return advanceJob(env, step, job, action, phase, cursor);
}

function agentRunDeletionAuthority(
  job: ResourceDeletionJobRecord,
):
  | { deletedAt: string; kind: "project"; projectId: string }
  | { deletedAt: string; kind: "thread"; threadId: string } {
  const deletedAt = job.generation.toISOString();
  if (job.kind === "project-deletion" && job.projectId) {
    return { deletedAt, kind: "project", projectId: job.projectId };
  }
  if (job.kind === "thread-deletion" && job.threadId) {
    return { deletedAt, kind: "thread", threadId: job.threadId };
  }
  throw deletionInvariant("Run deletion has incomplete resource-generation authority");
}

async function processRunObjects(
  env: ResourceDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ResourceDeletionJobRecord,
  action: number,
): Promise<ActionOutcome> {
  if (job.kind !== "thread-deletion" || !job.projectId || !job.cursor) {
    throw deletionInvariant("Thread run-object cleanup has incomplete ownership context");
  }
  const result = await guardedExternalStep(
    env,
    step,
    job,
    `delete run objects action ${action}`,
    () =>
      deleteR2ObjectPrefixBatch(env.R2_OUTPUTS, `${job.userId}/${job.projectId}/${job.cursor}/`),
  );
  if (!result) {
    return "noop";
  }
  const phase = result.hasMore ? "run-objects" : "runs";
  return advanceJob(env, step, job, action, phase, job.cursor);
}

async function processWorkspace(
  env: ResourceDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ResourceDeletionJobRecord,
  action: number,
): Promise<ActionOutcome> {
  if (job.kind !== "project-deletion" || !job.projectId || !job.workspaceSlug) {
    throw deletionInvariant("Project workspace cleanup has incomplete ownership context");
  }
  const projectId = job.projectId;
  const workspaceSlug = job.workspaceSlug;
  const deleted = await guardedExternalStep(
    env,
    step,
    job,
    `delete project workspace action ${action}`,
    async () => {
      await deleteProjectAgentWorkspace(env, {
        deletedAt: job.generation,
        projectId,
        userId: job.userId,
        workspaceSlug,
      });
      return true;
    },
  );
  return deleted ? advanceJob(env, step, job, action, "outputs", null) : "noop";
}

async function processOutputs(
  env: ResourceDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ResourceDeletionJobRecord,
  action: number,
): Promise<ActionOutcome> {
  const outputs = await loadOutputs(env, step, job, action);
  if (outputs.length === 0) {
    const phase = job.kind === "project-deletion" ? "prefix" : "pointer";
    return advanceJob(env, step, job, action, phase, null);
  }
  const deleted = await guardedExternalStep(
    env,
    step,
    job,
    `delete output objects action ${action}`,
    async () => {
      await env.R2_OUTPUTS.delete([...new Set(outputs.map(({ r2Key }) => r2Key))]);
      return true;
    },
  );
  if (!deleted) {
    return "noop";
  }
  const deletion = await dbStep(step, `delete output rows action ${action}`, () =>
    guardedDatabaseAction(env, job, (db) =>
      deleteResourceDeletionOutputRecords(
        db,
        deletionScope(job),
        outputs.map(outputFromWireRecord),
      ),
    ),
  );
  if (!deletion) {
    return "noop";
  }
  if (!deletion.current) {
    return cancelJob(env, step, job, action);
  }
  if (deletion.deleted !== outputs.length) {
    throw deletionInvariant("Generated output deletion lost its object-to-row identity");
  }
  return advanceJob(
    env,
    step,
    job,
    action,
    "outputs",
    requiredCursor(outputs.at(-1)?.id, "output"),
  );
}

async function processProjectPrefix(
  env: ResourceDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ResourceDeletionJobRecord,
  action: number,
): Promise<ActionOutcome> {
  if (job.kind !== "project-deletion" || !job.projectId) {
    throw deletionInvariant("Project prefix cleanup has incomplete ownership context");
  }
  const result = await guardedExternalStep(
    env,
    step,
    job,
    `delete project prefix action ${action}`,
    () => deleteR2ObjectPrefixBatch(env.R2_OUTPUTS, `${job.userId}/${job.projectId}/`),
  );
  if (!result) {
    return "noop";
  }
  const phase = result.hasMore ? "prefix" : "pointer";
  return advanceJob(env, step, job, action, phase, null);
}

async function processRunPointer(
  env: ResourceDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ResourceDeletionJobRecord,
  action: number,
): Promise<ActionOutcome> {
  const result = await dbStep(step, `clear run pointer action ${action}`, async () =>
    guardedDatabaseAction(env, job, async (db) =>
      job.kind === "project-deletion"
        ? (await clearProjectDeletionRunPointers(db, projectGeneration(job))).current
        : (await clearThreadDeletionRunPointer(db, threadGeneration(job))).current,
    ),
  );
  if (result === null) {
    return "noop";
  }
  return result
    ? advanceJob(env, step, job, action, "finalize", null)
    : cancelJob(env, step, job, action);
}

async function processFinalizer(
  env: ResourceDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ResourceDeletionJobRecord,
  action: number,
): Promise<ActionOutcome> {
  const finalized = await dbStep(step, `finalize database state action ${action}`, () =>
    guardedDatabaseAction(env, job, (db) =>
      job.kind === "project-deletion"
        ? finalizeProjectDeletion(db, projectGeneration(job))
        : finalizeThreadDeletion(db, threadGeneration(job)),
    ),
  );
  if (finalized === null) {
    return "noop";
  }
  if (!finalized) {
    return cancelJob(env, step, job, action);
  }
  const completed = await dbStep(step, `complete deletion job action ${action}`, () =>
    withUserDatabase(env, job.userId, (db) => completeResourceDeletionJob(db, exactJob(job))),
  );
  return completed ? "completed" : "noop";
}

async function continueDeletion(
  env: ResourceDeletionWorkflowEnv,
  step: WorkflowStep,
  lease: ResourceDeletionJobLease,
): Promise<{ outcome: WorkflowOutcome }> {
  const nextLeaseToken = await continuationLeaseToken(lease);
  const next = await dbStep(step, "reserve deletion continuation", () =>
    withUserDatabase(env, lease.userId, (db) =>
      reserveResourceDeletionContinuation(db, {
        ...lease,
        nextLeaseToken,
      }),
    ),
  );
  if (!next) {
    return { outcome: "noop" };
  }
  await step.sleep("reserve workflow creation headroom", "1 second");
  try {
    await step.do("create deletion continuation", CREATE_STEP_OPTIONS, async () => {
      await createResourceDeletionInstances(env, [next]);
      return { ok: true };
    });
    return { outcome: "continued" };
  } catch (error) {
    return RESOURCE_DELETION_RUNNER.handleFailure(env, step, next, error, "continuation");
  }
}

async function advanceJob(
  env: ResourceDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ResourceDeletionJobRecord,
  action: number,
  phase: ResourceDeletionJobRecord["phase"],
  cursor: string | null,
): Promise<ActionOutcome> {
  const advanced = await dbStep(step, `advance deletion action ${action}`, () =>
    withUserDatabase(env, job.userId, (db) =>
      advanceResourceDeletionJob(db, { ...exactJob(job), cursor, phase }),
    ),
  );
  return advanced ? "advanced" : "noop";
}

async function cancelJob(
  env: ResourceDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ResourceDeletionJobRecord,
  action: number,
): Promise<ActionOutcome> {
  await dbStep(step, `cancel stale deletion action ${action}`, () =>
    withUserDatabase(env, job.userId, (db) => completeResourceDeletionJob(db, exactJob(job))),
  );
  return "noop";
}

async function loadRunIds(
  env: ResourceDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ResourceDeletionJobRecord,
  action: number,
): Promise<AgentRunId[]> {
  const values = await dbStep(step, `load run ids action ${action}`, () =>
    withUserDatabase(env, job.userId, (db) =>
      job.kind === "project-deletion"
        ? listProjectDeletionRunIds(db, {
            ...(job.cursor ? { cursor: job.cursor } : {}),
            limit: PROJECT_RUN_PAGE_SIZE,
            projectId: requiredProjectId(job),
            userId: job.userId,
          })
        : listThreadDeletionRunIds(db, {
            ...(job.cursor ? { cursor: job.cursor } : {}),
            limit: 1,
            threadId: requiredThreadId(job),
            userId: job.userId,
          }),
    ),
  );
  return RunIdPageSchema.parse(values).map(AgentRunId);
}

async function loadOutputs(
  env: ResourceDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ResourceDeletionJobRecord,
  action: number,
): Promise<z.infer<typeof OutputPageSchema>> {
  const values = await dbStep(step, `load outputs action ${action}`, () =>
    withUserDatabase(env, job.userId, (db) =>
      (job.kind === "project-deletion"
        ? listProjectDeletionOutputs(db, {
            ...(job.cursor ? { cursor: job.cursor } : {}),
            limit: OUTPUT_PAGE_SIZE,
            projectId: requiredProjectId(job),
            userId: job.userId,
          })
        : listThreadDeletionOutputs(db, {
            ...(job.cursor ? { cursor: job.cursor } : {}),
            limit: OUTPUT_PAGE_SIZE,
            threadId: requiredThreadId(job),
            userId: job.userId,
          })
      ).then((records) => records.map(outputToWireRecord)),
    ),
  );
  return OutputPageSchema.parse(values);
}

async function createClaimedInstancesOrDefer(
  env: ResourceDeletionWorkflowEnv,
  leases: ResourceDeletionJobLease[],
): Promise<number> {
  if (leases.length === 0) {
    return 0;
  }
  try {
    return await createResourceDeletionInstances(env, leases);
  } catch (error) {
    await deferFailedInstanceCreations(env, leases, error);
    throw error;
  }
}

async function deferFailedInstanceCreations(
  env: ResourceDeletionWorkflowEnv,
  leases: ResourceDeletionJobLease[],
  error: unknown,
): Promise<void> {
  const errorCode = RESOURCE_DELETION_RUNNER.errorCode(error);
  let quarantined = 0;
  await withDatabase(env, async (db) => {
    for (const lease of leases) {
      const deferred = await withUserContext(db, lease.userId, (tx) =>
        deferResourceDeletionJob(tx, {
          ...lease,
          errorCode,
          maxFailures: MAX_TRANSIENT_DELETION_FAILURES,
        }),
      );
      if (deferred?.status === "quarantined") {
        quarantined += 1;
        RESOURCE_DELETION_RUNNER.reportQuarantine(env, { jobId: lease.jobId }, error, errorCode);
      }
    }
  });
  createLogger().warn("resource_deletion_instance_creation_deferred", {
    attempted: leases.length,
    errorCode,
    quarantined,
  });
}
