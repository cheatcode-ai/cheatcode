import type { WorkflowStep } from "cloudflare:workers";
import {
  advanceUserDeletionJob,
  archiveUserProjects,
  type Database,
  deferUserDeletionJob,
  deleteUserArtifactUploadIntents,
  hardDeleteUserV2Data,
  listUserArtifactUploadIntents,
  listUserDeletionIntegrationPage,
  listUserDeletionRunPage,
  loadUserDeletionContext,
  quarantineUserDeletionJob,
  renewAndLoadUserDeletionJob,
  reserveUserDeletionContinuation,
  type UserDeletionContext,
  type UserDeletionJobLease,
  type UserDeletionJobRecord,
  type UserDeletionPage,
} from "@cheatcode/db";
import { createLogger } from "@cheatcode/observability";
import { UserId } from "@cheatcode/types";
import { z } from "zod";
import {
  CREATE_STEP_OPTIONS,
  continuationLeaseToken as createContinuationLeaseToken,
  createDeletionJobRunner,
  type DeletionActionOutcome,
  type DeletionWorkflowOutcome,
  dbStep,
  deletionErrorClassifier,
  MAX_TRANSIENT_DELETION_FAILURES,
  runDeletionActions,
  withUserDatabase,
} from "./deletion-job-runner";
import {
  deleteUserAgentAccountState,
  deleteUserAgentRunStatePage,
  deleteUserQuotaDurableState,
  deleteUserR2ObjectBatch,
  type LifecycleEnv,
  revokeUserComposioConnectionPage,
} from "./lifecycle-adapters";
import {
  createUserDeletionContinuation,
  type UserDeletionAdmissionEnv,
  type UserDeletionPayload,
} from "./user-deletion-admission";
import {
  ARTIFACT_INTENT_PAGE_SIZE,
  artifactIntentsToWire,
  processUserDeletionArtifactIntents,
} from "./user-deletion-artifact-intents";
import { processUserDeletionBilling } from "./user-deletion-billing";
import { UserDeletionPhaseSchema } from "./user-deletion-phase";

const RUN_PAGE_SIZE = 500;
const INTEGRATION_PAGE_SIZE = 10;
const EXTERNAL_STEP_OPTIONS = {
  retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
  timeout: "15 minutes",
} as const;
const COMPOSIO_STEP_OPTIONS = {
  retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} as const;

const ActiveJobSchema = z
  .object({
    continuation: z.number().int().nonnegative(),
    cursor: z.string().nullable(),
    deletionFence: z.string().regex(/^\d+$/u),
    generation: z.string().datetime({ offset: true }),
    jobId: z.string().uuid(),
    leaseToken: z.string().uuid(),
    phase: UserDeletionPhaseSchema,
    userId: z.string().uuid(),
  })
  .strict();
const ClaimedJobSchema = z.discriminatedUnion("state", [
  z.object({ state: z.enum(["lost", "stale"]) }).strict(),
  z.object({ job: ActiveJobSchema, state: z.literal("active") }).strict(),
]);
const DeletionContextSchema = z
  .object({
    clerkIdentityHash: z.string().regex(/^[0-9a-f]{64}$/u),
    deletionFence: z.string().regex(/^\d+$/u),
    polarCustomerId: z.string().nullable(),
    polarCurrentPeriodEndMs: z.number().int().nullable(),
    polarCurrentPeriodStartMs: z.number().int().nullable(),
    polarSubscriptionId: z.string().nullable(),
    userId: z.string().uuid(),
  })
  .strict();
const DeletionPageSchema = z
  .object({
    items: z.array(z.string().min(1)).max(RUN_PAGE_SIZE),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();
const R2DeletionResultSchema = z
  .object({ deleted: z.number().int().nonnegative().max(1_000), hasMore: z.boolean() })
  .strict();

type ActiveJob = z.infer<typeof ActiveJobSchema> & { userId: ReturnType<typeof UserId> };
type ActionOutcome = DeletionActionOutcome;
type WorkflowOutcome = DeletionWorkflowOutcome;
type ExternalStepOptions = typeof COMPOSIO_STEP_OPTIONS | typeof EXTERNAL_STEP_OPTIONS;

export interface UserDeletionWorkflowEnv extends LifecycleEnv, UserDeletionAdmissionEnv {}

class UserDeletionInvariantError extends Error {
  public readonly retriable = false;
}

type DeferredUserDeletion = NonNullable<Awaited<ReturnType<typeof deferUserDeletionJob>>>;

const USER_DELETION_RUNNER = createDeletionJobRunner<
  UserDeletionWorkflowEnv,
  UserDeletionJobLease,
  DeferredUserDeletion
>({
  classify: deletionErrorClassifier({
    invalidStateCode: "user_deletion_invalid_state",
    invariantCode: "user_deletion_invariant",
    isInvariant: (error) => error instanceof UserDeletionInvariantError,
  }),
  defer: (env, step, lease, errorCode, label) =>
    dbStep(step, `${label} defer account deletion`, () =>
      withUserDatabase(env, lease.userId, (db) =>
        deferUserDeletionJob(db, {
          ...lease,
          errorCode,
          maxFailures: MAX_TRANSIENT_DELETION_FAILURES,
        }),
      ),
    ),
  onDeferred: (_env, lease, _error, errorCode, _label, deferred) => {
    if (deferred && deferred.status !== "quarantined") {
      createLogger().warn("user_deletion_deferred", {
        errorCode,
        failureCount: deferred.failureCount,
        jobId: lease.jobId,
      });
    }
  },
  quarantine: {
    errorEventName: "user_deletion_quarantined",
    errorRoute: "user-deletion-workflow",
    failureName: "UserDeletionQuarantined",
    fallbackMessage: "Account deletion quarantine termination failed",
    identity: (lease) => ({ jobId: lease.jobId }),
    logEventName: "user_deletion_quarantined",
    message: (errorCode) => `Account deletion quarantined (${errorCode})`,
    quarantine: (env, step, lease, errorCode, label) =>
      dbStep(step, `${label} quarantine account deletion`, () =>
        withUserDatabase(env, lease.userId, (db) =>
          quarantineUserDeletionJob(db, { ...lease, errorCode }),
        ),
      ),
    terminationStepName: (label) => `${label} terminate quarantined account deletion`,
  },
});

export async function processUserDeletionChunk(
  env: UserDeletionWorkflowEnv,
  payload: UserDeletionPayload,
  step: WorkflowStep,
): Promise<{ outcome: WorkflowOutcome }> {
  const lease = payloadLease(payload);
  try {
    return await processActions(env, payload, lease, step);
  } catch (error) {
    return USER_DELETION_RUNNER.handleFailure(env, step, lease, error, "execution");
  }
}

async function processActions(
  env: UserDeletionWorkflowEnv,
  payload: UserDeletionPayload,
  lease: UserDeletionJobLease,
  step: WorkflowStep,
): Promise<{ outcome: WorkflowOutcome }> {
  return runDeletionActions({
    continueDeletion: () => continueDeletion(env, step, lease, payload.releaseVersionId),
    load: (action) => loadCurrentJob(env, step, lease, action),
    process: (job, action) => processAction(env, step, job, action),
  });
}

async function loadCurrentJob(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  lease: UserDeletionJobLease,
  action: number,
): Promise<ActiveJob | null> {
  const value = await dbStep(step, `revalidate account deletion action ${action}`, async () => {
    const claimed = await withUserDatabase(env, lease.userId, (db) =>
      renewAndLoadUserDeletionJob(db, lease),
    );
    return claimed.state === "active"
      ? { job: jobToWire(claimed.job), state: claimed.state }
      : { state: claimed.state };
  });
  const claimed = ClaimedJobSchema.parse(value);
  return claimed.state === "active" ? { ...claimed.job, userId: UserId(claimed.job.userId) } : null;
}

function jobToWire(job: UserDeletionJobRecord): z.infer<typeof ActiveJobSchema> {
  return {
    continuation: job.continuation,
    cursor: job.cursor,
    deletionFence: job.deletionFence,
    generation: job.generation.toISOString(),
    jobId: job.jobId,
    leaseToken: job.leaseToken,
    phase: job.phase,
    userId: job.userId,
  };
}

async function processAction(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
): Promise<ActionOutcome> {
  switch (job.phase) {
    case "runs":
      return processRuns(env, step, job, action);
    case "sandbox":
      return processSandbox(env, step, job, action);
    case "billing":
      return processBilling(env, step, job, action);
    case "quota":
      return processQuota(env, step, job, action);
    case "integrations":
      return processIntegrations(env, step, job, action);
    case "objects":
      return processObjects(env, step, job, action);
    case "archive":
      return processArchive(env, step, job, action);
    case "finalize":
      return processFinalizer(env, step, job, action);
  }
}

async function processRuns(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
): Promise<ActionOutcome> {
  const page = await loadRunPage(env, step, job, action);
  if (page.items.length === 0) {
    assertEmptyTerminalPage(page, "run");
    return advanceJob(env, step, job, action, "sandbox", null);
  }
  const deleted = await guardedVoidExternalStep(
    env,
    step,
    job,
    `delete account run state action ${action}`,
    () =>
      deleteUserAgentRunStatePage(env, job.userId, page.items, {
        deletionFence: job.deletionFence,
        kind: "account",
      }),
  );
  if (!deleted) {
    return "noop";
  }
  return page.nextCursor
    ? advanceJob(env, step, job, action, "runs", page.nextCursor)
    : advanceJob(env, step, job, action, "sandbox", null);
}

async function loadRunPage(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
): Promise<UserDeletionPage> {
  const value = await dbStep(step, `load account run page action ${action}`, () =>
    withUserDatabase(env, job.userId, (db) =>
      listUserDeletionRunPage(db, {
        ...(job.cursor ? { cursor: job.cursor } : {}),
        deletionFence: job.deletionFence,
        limit: RUN_PAGE_SIZE,
        userId: job.userId,
      }),
    ),
  );
  return DeletionPageSchema.parse(value);
}

async function processSandbox(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
): Promise<ActionOutcome> {
  const deleted = await guardedVoidExternalStep(
    env,
    step,
    job,
    `delete account sandbox action ${action}`,
    () => deleteUserAgentAccountState(env, job.userId, job.deletionFence),
  );
  return deleted ? advanceJob(env, step, job, action, "billing", null) : "noop";
}

async function processBilling(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
): Promise<ActionOutcome> {
  const context = await loadContext(env, step, job, action, "billing");
  return processUserDeletionBilling(env, context, job, action, {
    advance: (cursor, phase) => advanceJob(env, step, job, action, phase, cursor),
    database: (name, operation) =>
      dbStep(step, name, () => withUserDatabase(env, job.userId, operation)),
    directDatabase: (operation) => withUserDatabase(env, job.userId, operation),
    external: (name, operation) => guardedExternalStep(env, step, job, name, operation),
  });
}

async function processQuota(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
): Promise<ActionOutcome> {
  const deleted = await guardedVoidExternalStep(
    env,
    step,
    job,
    `delete account quota state action ${action}`,
    () => deleteUserQuotaDurableState(env, job.userId),
  );
  return deleted ? advanceJob(env, step, job, action, "integrations", null) : "noop";
}

async function processIntegrations(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
): Promise<ActionOutcome> {
  const page = await loadIntegrationPage(env, step, job, action);
  if (page.items.length === 0) {
    assertEmptyTerminalPage(page, "integration");
    return advanceJob(env, step, job, action, "objects", null);
  }
  const revoked = await guardedExternalStep(
    env,
    step,
    job,
    `revoke account integrations action ${action}`,
    () => revokeUserComposioConnectionPage(env, page.items),
    COMPOSIO_STEP_OPTIONS,
  );
  if (revoked === null) {
    return "noop";
  }
  if (revoked !== page.items.length) {
    throw deletionInvariant("Composio deletion lost a connection identity");
  }
  return page.nextCursor
    ? advanceJob(env, step, job, action, "integrations", page.nextCursor)
    : advanceJob(env, step, job, action, "objects", null);
}

async function loadIntegrationPage(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
): Promise<UserDeletionPage> {
  const value = await dbStep(step, `load account integration page action ${action}`, () =>
    withUserDatabase(env, job.userId, (db) =>
      listUserDeletionIntegrationPage(db, {
        ...(job.cursor ? { cursor: job.cursor } : {}),
        deletionFence: job.deletionFence,
        limit: INTEGRATION_PAGE_SIZE,
        userId: job.userId,
      }),
    ),
  );
  return DeletionPageSchema.parse(value);
}

async function processObjects(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
): Promise<ActionOutcome> {
  const value = await guardedExternalStep(
    env,
    step,
    job,
    `delete account objects action ${action}`,
    () => deleteUserR2ObjectBatch(env.R2_OUTPUTS, job.userId),
  );
  if (value === null) {
    return "noop";
  }
  const result = R2DeletionResultSchema.parse(value);
  if (result.hasMore) {
    return advanceJob(env, step, job, action, "objects", null);
  }
  // The runs phase joined every AgentRun before this prefix sweep completed, so
  // no upload request can recreate an object while its durable intent is removed.
  return processArtifactIntents(env, step, job, action);
}

async function processArtifactIntents(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
): Promise<ActionOutcome> {
  return processUserDeletionArtifactIntents({
    advance: (phase) => advanceJob(env, step, job, action, phase, null),
    deleteRows: (intents) =>
      dbStep(step, `delete account artifact intents action ${action}`, () =>
        guardedDatabaseAction(env, job, (db) =>
          deleteUserArtifactUploadIntents(db, {
            deletionFence: job.deletionFence,
            intents,
            userId: job.userId,
          }),
        ),
      ),
    list: () =>
      dbStep(step, `load account artifact intents action ${action}`, () =>
        withUserDatabase(env, job.userId, (db) =>
          listUserArtifactUploadIntents(db, {
            deletionFence: job.deletionFence,
            limit: ARTIFACT_INTENT_PAGE_SIZE,
            userId: job.userId,
          }).then(artifactIntentsToWire),
        ),
      ),
  });
}

async function processArchive(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
): Promise<ActionOutcome> {
  const archived = await dbStep(step, `archive account projects action ${action}`, () =>
    guardedDatabaseAction(env, job, async (db) => {
      await archiveUserProjects(db, job.userId, job.deletionFence);
      return true;
    }),
  );
  return archived === true ? advanceJob(env, step, job, action, "finalize", null) : "noop";
}

async function processFinalizer(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
): Promise<ActionOutcome> {
  const context = await loadContext(env, step, job, action, "finalization");
  const finalized = await dbStep(step, `finalize account deletion action ${action}`, () =>
    guardedDatabaseAction(env, job, (db) =>
      hardDeleteUserV2Data(db, job.userId, job.deletionFence, context.clerkIdentityHash),
    ),
  );
  if (finalized === null) {
    return "noop";
  }
  if (!finalized) {
    throw deletionInvariant("Account deletion did not finalize its exact identity");
  }
  return "completed";
}

async function loadContext(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
  label: string,
): Promise<UserDeletionContext> {
  const value = await dbStep(step, `load account ${label} context action ${action}`, () =>
    withUserDatabase(env, job.userId, (db) =>
      loadUserDeletionContext(db, job.userId, job.deletionFence),
    ),
  );
  const parsed = DeletionContextSchema.parse(value);
  return { ...parsed, userId: UserId(parsed.userId) };
}

async function advanceJob(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  action: number,
  phase: ActiveJob["phase"],
  cursor: string | null,
): Promise<Extract<ActionOutcome, "advanced" | "noop">> {
  const advanced = await dbStep(step, `advance account deletion action ${action}`, () =>
    withUserDatabase(env, job.userId, (db) =>
      advanceUserDeletionJob(db, {
        ...jobLease(job),
        cursor,
        expectedCursor: job.cursor,
        expectedPhase: job.phase,
        phase,
      }),
    ),
  );
  return advanced ? "advanced" : "noop";
}

async function guardedVoidExternalStep(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  name: string,
  operation: () => Promise<void>,
): Promise<boolean> {
  const result = await guardedExternalStep(env, step, job, name, async () => {
    await operation();
    return true;
  });
  return result === true;
}

async function guardedExternalStep<Result extends Rpc.Serializable<Result>>(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  job: ActiveJob,
  name: string,
  operation: () => Promise<Result>,
  options: ExternalStepOptions = EXTERNAL_STEP_OPTIONS,
): Promise<Result | null> {
  return externalStep(
    step,
    name,
    async () => ((await isActionCurrent(env, job)) ? operation() : null),
    options,
  );
}

async function guardedDatabaseAction<Result extends Rpc.Serializable<Result>>(
  env: UserDeletionWorkflowEnv,
  job: ActiveJob,
  operation: (db: Database) => Promise<Result>,
): Promise<Result | null> {
  return withUserDatabase(env, job.userId, async (db) =>
    (await isActionCurrentInDatabase(db, job)) ? operation(db) : null,
  );
}

async function isActionCurrent(env: UserDeletionWorkflowEnv, job: ActiveJob): Promise<boolean> {
  return withUserDatabase(env, job.userId, (db) => isActionCurrentInDatabase(db, job));
}

async function isActionCurrentInDatabase(db: Database, job: ActiveJob): Promise<boolean> {
  const claimed = await renewAndLoadUserDeletionJob(db, jobLease(job));
  return (
    claimed.state === "active" &&
    claimed.job.phase === job.phase &&
    claimed.job.cursor === job.cursor
  );
}

async function continueDeletion(
  env: UserDeletionWorkflowEnv,
  step: WorkflowStep,
  lease: UserDeletionJobLease,
  releaseVersionId: UserDeletionPayload["releaseVersionId"],
): Promise<{ outcome: WorkflowOutcome }> {
  const nextLeaseToken = await continuationLeaseToken(lease);
  const next = await dbStep(step, "reserve account deletion continuation", () =>
    withUserDatabase(env, lease.userId, (db) =>
      reserveUserDeletionContinuation(db, { ...lease, nextLeaseToken }),
    ),
  );
  if (!next) {
    return { outcome: "noop" };
  }
  try {
    await step.do("create account deletion continuation", CREATE_STEP_OPTIONS, () =>
      createUserDeletionContinuation(env, next, releaseVersionId),
    );
    return { outcome: "continued" };
  } catch (error) {
    return USER_DELETION_RUNNER.handleFailure(env, step, next, error, "continuation");
  }
}

function payloadLease(payload: UserDeletionPayload): UserDeletionJobLease {
  return {
    continuation: payload.continuation,
    jobId: payload.jobId,
    leaseToken: payload.leaseToken,
    userId: UserId(payload.userId),
  };
}

function jobLease(job: ActiveJob): UserDeletionJobLease {
  return {
    continuation: job.continuation,
    jobId: job.jobId,
    leaseToken: job.leaseToken,
    userId: job.userId,
  };
}

async function continuationLeaseToken(lease: UserDeletionJobLease): Promise<string> {
  return createContinuationLeaseToken(`${lease.jobId}:${lease.continuation + 1}`, () =>
    deletionInvariant("Account deletion continuation digest was incomplete"),
  );
}

function assertEmptyTerminalPage(page: UserDeletionPage, label: string): void {
  if (page.nextCursor) {
    throw deletionInvariant(`Empty ${label} deletion page returned a continuation cursor`);
  }
}

function deletionInvariant(message: string): UserDeletionInvariantError {
  return new UserDeletionInvariantError(message);
}

async function externalStep<Result extends Rpc.Serializable<Result>>(
  step: WorkflowStep,
  name: string,
  operation: () => Promise<Result>,
  options: ExternalStepOptions = EXTERNAL_STEP_OPTIONS,
): Promise<Result> {
  return step.do(name, options, operation);
}
