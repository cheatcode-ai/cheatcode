import type { WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  type ActivationEventCursor,
  advanceRetentionJob,
  completeRetentionJob,
  createDb,
  type Database,
  deferRetentionJob,
  type HyperdriveConnection,
  listDailyActivationEventPage,
  type RetentionJobLease,
  type RetentionJobProgress,
  type RetentionJobRecord,
  renewAndLoadRetentionJob,
  reserveRetentionContinuation,
} from "@cheatcode/db";
import type { CloudflareVersionMetadata, WorkerSecret } from "@cheatcode/env";
import {
  type AnalyticsBindings,
  createLogger,
  emitErrorEvent,
  emitUserEvent,
  safeErrorTelemetry,
} from "@cheatcode/observability";
import { z } from "zod";
import { assertReleaseCanDrain, type ReleaseGateBindings } from "./release-gate";
import { processArtifactIntentCleanupGeneration } from "./retention-artifact-intents";
import { createDeterministicWorkflow, type DeterministicWorkflowResult } from "./workflow-instance";

const ACTIVATION_EVENT_PAGE_SIZE = 200;
const ACTIVATION_PAGES_PER_GENERATION = 4;
const DEVELOPMENT_RELEASE_VERSION_ID = "00000000-0000-4000-8000-000000000001";

const DB_STEP_OPTIONS = {
  retries: { limit: 2, delay: "15 seconds", backoff: "exponential" },
  timeout: "90 seconds",
} as const;
const CREATE_STEP_OPTIONS = {
  retries: { limit: 3, delay: "15 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} as const;

const RetentionDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const RetentionPayloadBase = {
  day: RetentionDaySchema,
  kind: z.literal("retention-metrics"),
  leaseToken: z.string().uuid(),
  releaseVersionId: z.string().uuid(),
} as const;

export const RetentionMaintenancePayloadSchema = z.discriminatedUnion("mode", [
  z
    .object({
      ...RetentionPayloadBase,
      continuation: z.literal(0),
      mode: z.literal("initial"),
    })
    .strict(),
  z
    .object({
      ...RetentionPayloadBase,
      continuation: z.number().int().positive().max(2_147_483_647),
      mode: z.literal("continuation"),
    })
    .strict(),
]);

export type RetentionMaintenancePayload = z.infer<typeof RetentionMaintenancePayloadSchema>;

interface RetentionWorkflowBindings extends ReleaseGateBindings {
  OPS_WORKFLOW: Workflow<RetentionMaintenancePayload>;
}

export interface RetentionMaintenanceEnv extends AnalyticsBindings, RetentionWorkflowBindings {
  CF_VERSION_METADATA?: CloudflareVersionMetadata;
  CHEATCODE_ENVIRONMENT: "development" | "production";
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
  HYPERDRIVE: HyperdriveConnection;
  R2_OUTPUTS: R2Bucket;
}

const ActivationEventCursorSchema = z
  .object({
    eventName: z.enum(["retention_d7", "retention_d28", "first_week_mau"]),
    userId: z.string().uuid(),
  })
  .strict();
const ActivationEventPageItemsSchema = z
  .array(
    z
      .object({
        cohortMonth: z.string().optional(),
        cohortWeek: z.string().optional(),
        eventName: ActivationEventCursorSchema.shape.eventName,
        userId: ActivationEventCursorSchema.shape.userId,
      })
      .strict(),
  )
  .max(ACTIVATION_EVENT_PAGE_SIZE);
const ActivationPageResultSchema = z
  .object({
    emitted: z.number().int().min(0).max(ACTIVATION_EVENT_PAGE_SIZE),
    nextCursor: ActivationEventCursorSchema.nullable(),
  })
  .strict();
const ActiveRetentionJobSchema = z
  .object({
    activationCursor: ActivationEventCursorSchema.nullable(),
    continuation: z.number().int().nonnegative(),
    day: RetentionDaySchema,
    leaseToken: z.string().uuid(),
    phase: z.enum(["activation", "cleanup"]),
    releaseVersionId: z.string().uuid(),
    scheduledAt: z.string().datetime({ offset: true }),
  })
  .strict();
const ClaimedRetentionJobSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("lost") }).strict(),
  z.object({ job: ActiveRetentionJobSchema, state: z.literal("active") }).strict(),
]);
type ActivationEventPageItem = z.infer<typeof ActivationEventPageItemsSchema>[number];
type GenerationOutcome = { job: RetentionJobRecord; state: "continue" } | { state: "done" };
export async function processDailyRetention(
  env: RetentionMaintenanceEnv,
  instanceId: string,
  payloadInput: RetentionMaintenancePayload,
  step: WorkflowStep,
): Promise<void> {
  const payload = RetentionMaintenancePayloadSchema.parse(payloadInput);
  assertRetentionWorkflowIdentity(instanceId, payload);
  assertRetentionRelease(env, payload);
  const lease = payloadLease(payload);
  try {
    const job = await loadCurrentJob(env, step, lease);
    if (!job) {
      return;
    }
    const outcome = await processRetentionGeneration(env, step, job);
    if (outcome.state === "continue") {
      await continueRetention(env, step, outcome.job);
    }
  } catch (error) {
    await deferWorkflowFailure(env, step, lease, error, "execution");
  }
}

async function processRetentionGeneration(
  env: RetentionMaintenanceEnv,
  step: WorkflowStep,
  job: RetentionJobRecord,
): Promise<GenerationOutcome> {
  if (job.phase === "activation") {
    return processActivationGeneration(env, step, job);
  }
  const intents = await processArtifactIntentCleanupGeneration(env, step, job);
  if (intents.state !== "ready") {
    return intents;
  }
  await completeCleanup(env, step, job, 1);
  return { state: "done" };
}

async function loadCurrentJob(
  env: RetentionMaintenanceEnv,
  step: WorkflowStep,
  lease: RetentionJobLease,
): Promise<RetentionJobRecord | null> {
  const value = await step.do("load retention generation lease", DB_STEP_OPTIONS, async () => {
    const claimed = await withDatabase(env, (db) => renewAndLoadRetentionJob(db, lease));
    return claimed.state === "active"
      ? { job: jobToWire(claimed.job), state: "active" as const }
      : { state: "lost" as const };
  });
  const claimed = ClaimedRetentionJobSchema.parse(value);
  return claimed.state === "active" ? jobFromWire(claimed.job) : null;
}

async function processActivationGeneration(
  env: RetentionMaintenanceEnv,
  step: WorkflowStep,
  initialJob: RetentionJobRecord,
): Promise<GenerationOutcome> {
  let job = initialJob;
  for (let action = 1; action <= ACTIVATION_PAGES_PER_GENERATION; action += 1) {
    const page = await emitActivationPage(env, step, job, action);
    const next = page.nextCursor ? activationProgress(page.nextCursor) : cleanupProgress();
    const advanced = await persistProgress(env, step, job, next, action);
    if (!advanced) {
      return { state: "done" };
    }
    job = jobWithProgress(job, next);
    if (next.phase === "cleanup") {
      return { job, state: "continue" };
    }
  }
  return { job, state: "continue" };
}

async function emitActivationPage(
  env: RetentionMaintenanceEnv,
  step: WorkflowStep,
  job: RetentionJobRecord,
  action: number,
): Promise<z.infer<typeof ActivationPageResultSchema>> {
  const value = await step.do(`emit activation page ${action}`, DB_STEP_OPTIONS, async () => {
    const page = await withDatabase(env, (db) =>
      listDailyActivationEventPage(db, {
        ...(job.activationCursor ? { cursor: job.activationCursor } : {}),
        day: job.day,
        limit: ACTIVATION_EVENT_PAGE_SIZE,
      }),
    );
    const items = ActivationEventPageItemsSchema.parse(page.items);
    const result = ActivationPageResultSchema.parse({
      emitted: items.length,
      nextCursor: page.nextCursor,
    });
    assertActivationPageConsistent(job.activationCursor, items, result.nextCursor);
    emitActivationEvents(env, items, job.day);
    return result;
  });
  const result = ActivationPageResultSchema.parse(value);
  assertActivationCursorAdvanced(job.activationCursor, result.nextCursor);
  return result;
}

async function persistProgress(
  env: RetentionMaintenanceEnv,
  step: WorkflowStep,
  job: RetentionJobRecord,
  next: RetentionJobProgress,
  action: number,
): Promise<boolean> {
  return step.do(`persist retention progress ${action}`, DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) =>
      advanceRetentionJob(db, {
        ...jobLease(job),
        expected: jobProgress(job),
        next,
      }),
    ),
  );
}

async function completeCleanup(
  env: RetentionMaintenanceEnv,
  step: WorkflowStep,
  job: RetentionJobRecord,
  action: number,
): Promise<void> {
  const completed = await step.do(`complete retention cleanup ${action}`, DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) =>
      completeRetentionJob(db, { ...jobLease(job), expected: jobProgress(job) }),
    ),
  );
  if (completed) {
    createLogger().info("daily_retention_completed", {
      continuation: job.continuation,
      day: job.day,
    });
  }
}

async function continueRetention(
  env: RetentionMaintenanceEnv,
  step: WorkflowStep,
  job: RetentionJobRecord,
): Promise<void> {
  assertReleaseCanDrain(env);
  const nextLeaseToken = await continuationLeaseToken(jobLease(job));
  const next = await step.do("reserve retention continuation", DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) =>
      reserveRetentionContinuation(db, {
        ...jobLease(job),
        expected: jobProgress(job),
        nextLeaseToken,
      }),
    ),
  );
  if (!next) {
    return;
  }
  try {
    await step.do("create retention continuation", CREATE_STEP_OPTIONS, () =>
      createRetentionInstance(env, next),
    );
  } catch (error) {
    await deferWorkflowFailure(env, step, next, error, "continuation");
  }
}

async function deferWorkflowFailure(
  env: RetentionMaintenanceEnv,
  step: WorkflowStep,
  lease: RetentionJobLease,
  error: unknown,
  label: string,
): Promise<void> {
  const errorCode = retentionErrorCode(error);
  const deferred = await step.do(`${label} defer retention job`, DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) => deferRetentionJob(db, { ...lease, errorCode })),
  );
  createLogger().warn("daily_retention_deferred", {
    continuation: lease.continuation,
    day: lease.day,
    errorCode,
    failureCount: deferred?.failureCount,
    label,
    ...safeErrorTelemetry(error),
  });
  emitErrorEvent(env, {
    errorCategory: "workflow",
    errorCode: "daily_retention_deferred",
    route: "retention-maintenance",
    workerName: "webhooks",
  });
}

export function createRetentionInstance(
  env: RetentionMaintenanceEnv,
  lease: RetentionJobLease,
): Promise<DeterministicWorkflowResult> {
  const payload = retentionPayload(lease);
  return createDeterministicWorkflow(env.OPS_WORKFLOW, {
    id: retentionWorkflowIdentity(payload),
    params: payload,
    retention: { errorRetention: "30 days", successRetention: "7 days" },
  });
}

function retentionPayload(lease: RetentionJobLease): RetentionMaintenancePayload {
  return RetentionMaintenancePayloadSchema.parse({
    ...lease,
    kind: "retention-metrics",
    mode: lease.continuation === 0 ? "initial" : "continuation",
  });
}

function payloadLease(payload: RetentionMaintenancePayload): RetentionJobLease {
  return {
    continuation: payload.continuation,
    day: payload.day,
    leaseToken: payload.leaseToken,
    releaseVersionId: payload.releaseVersionId,
  };
}

function jobLease(job: RetentionJobRecord): RetentionJobLease {
  return {
    continuation: job.continuation,
    day: job.day,
    leaseToken: job.leaseToken,
    releaseVersionId: job.releaseVersionId,
  };
}

function jobProgress(job: RetentionJobRecord): RetentionJobProgress {
  return {
    activationCursor: job.activationCursor,
    phase: job.phase,
  };
}

function activationProgress(cursor: ActivationEventCursor): RetentionJobProgress {
  return { activationCursor: cursor, phase: "activation" };
}

function cleanupProgress(): RetentionJobProgress {
  return { activationCursor: null, phase: "cleanup" };
}

function jobWithProgress(
  job: RetentionJobRecord,
  progress: RetentionJobProgress,
): RetentionJobRecord {
  return { ...job, ...progress };
}

function jobToWire(job: RetentionJobRecord): z.infer<typeof ActiveRetentionJobSchema> {
  return {
    ...job,
    scheduledAt: job.scheduledAt.toISOString(),
  };
}

function jobFromWire(job: z.infer<typeof ActiveRetentionJobSchema>): RetentionJobRecord {
  return {
    ...job,
    scheduledAt: new Date(job.scheduledAt),
  };
}

function retentionWorkflowIdentity(payloadInput: RetentionMaintenancePayload): string {
  const payload = RetentionMaintenancePayloadSchema.parse(payloadInput);
  const id = [
    "rt",
    payload.day,
    payload.continuation,
    payload.releaseVersionId.replaceAll("-", ""),
    payload.leaseToken.replaceAll("-", ""),
  ].join("-");
  if (id.length > 100) {
    throw new Error("Retention Workflow identity exceeded Cloudflare's 100-character limit");
  }
  return id;
}

function assertRetentionWorkflowIdentity(
  instanceId: string,
  payload: RetentionMaintenancePayload,
): void {
  if (instanceId !== retentionWorkflowIdentity(payload)) {
    throw new NonRetryableError(
      "Retention Workflow identity does not match its immutable lease payload",
      "RetentionWorkflowIdentityInvalid",
    );
  }
}

function assertRetentionRelease(
  env: RetentionMaintenanceEnv,
  payload: RetentionMaintenancePayload,
): void {
  if (payload.releaseVersionId !== activeRetentionReleaseVersion(env)) {
    throw new NonRetryableError(
      "Retention Workflow lease belongs to a different Worker release",
      "RetentionWorkflowReleaseInvalid",
    );
  }
}

export function activeRetentionReleaseVersion(env: RetentionMaintenanceEnv): string {
  if (env.CHEATCODE_ENVIRONMENT !== "production") {
    return DEVELOPMENT_RELEASE_VERSION_ID;
  }
  return z.string().uuid().parse(env.CF_VERSION_METADATA?.id);
}

async function continuationLeaseToken(lease: RetentionJobLease): Promise<string> {
  const input = new TextEncoder().encode(
    `retention:${lease.day}:${lease.continuation + 1}:${lease.releaseVersionId}`,
  );
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", input)).slice(0, 16);
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("Retention continuation digest was incomplete");
  }
  bytes[6] = (versionByte & 0x0f) | 0x80;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertActivationPageConsistent(
  previous: ActivationEventCursor | null,
  items: ActivationEventPageItem[],
  next: ActivationEventCursor | null,
): void {
  assertActivationCursorAdvanced(previous, next);
  if (!next) {
    return;
  }
  const last = items.at(-1);
  if (!last || last.eventName !== next.eventName || last.userId !== next.userId) {
    throw retentionInvariant("Activation continuation cursor does not identify the page tail");
  }
  if (items.length !== ACTIVATION_EVENT_PAGE_SIZE) {
    throw retentionInvariant("A continuing activation page must be full");
  }
}

function assertActivationCursorAdvanced(
  previous: ActivationEventCursor | null,
  next: ActivationEventCursor | null,
): void {
  if (!previous || !next) {
    return;
  }
  const previousOrder = activationEventOrder(previous.eventName);
  const nextOrder = activationEventOrder(next.eventName);
  if (
    nextOrder < previousOrder ||
    (nextOrder === previousOrder && next.userId <= previous.userId)
  ) {
    throw retentionInvariant("Activation cursor did not advance in database key order");
  }
}

function activationEventOrder(eventName: ActivationEventPageItem["eventName"]): number {
  if (eventName === "retention_d7") {
    return 1;
  }
  if (eventName === "retention_d28") {
    return 2;
  }
  return 3;
}

function emitActivationEvents(
  env: AnalyticsBindings,
  rows: ActivationEventPageItem[],
  day: string,
): void {
  for (const row of rows) {
    emitUserEvent(env, {
      ...(row.cohortMonth ? { cohortMonth: row.cohortMonth } : {}),
      ...(row.cohortWeek ? { cohortWeek: row.cohortWeek } : {}),
      eventDate: day,
      eventId: `activation:${day}:${row.eventName}:${row.userId}`,
      eventName: row.eventName,
      userId: row.userId,
    });
  }
}

function retentionErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9_.:$-]{0,127}$/u.test(name) ? name : "UnknownError";
}

function retentionInvariant(message: string): NonRetryableError {
  return new NonRetryableError(message, "RetentionInvariantViolation");
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

export function previousUtcDay(now: Date): string {
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  startOfToday.setUTCDate(startOfToday.getUTCDate() - 1);
  return startOfToday.toISOString().slice(0, 10);
}
