import type { WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  type ActivationEventCursor,
  advanceDailyMaintenanceJob,
  completeDailyMaintenanceJob,
  createDb,
  type DailyMaintenanceJobLease,
  type DailyMaintenanceJobProgress,
  type DailyMaintenanceJobRecord,
  type Database,
  deferDailyMaintenanceJob,
  type HyperdriveConnection,
  listDailyActivationEventPage,
  renewAndLoadDailyMaintenanceJob,
  reserveDailyMaintenanceContinuation,
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
import { processOrphanUploadCleanupGeneration } from "./orphan-upload-cleanup";
import { assertReleaseCanDrain, type ReleaseGateBindings } from "./release-gate";
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

const DailyMaintenanceDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const DailyMaintenancePayloadBase = {
  day: DailyMaintenanceDaySchema,
  kind: z.literal("daily-maintenance"),
  leaseToken: z.string().uuid(),
  releaseVersionId: z.string().uuid(),
} as const;

export const DailyMaintenancePayloadSchema = z.discriminatedUnion("mode", [
  z
    .object({
      ...DailyMaintenancePayloadBase,
      continuation: z.literal(0),
      mode: z.literal("initial"),
    })
    .strict(),
  z
    .object({
      ...DailyMaintenancePayloadBase,
      continuation: z.number().int().positive().max(2_147_483_647),
      mode: z.literal("continuation"),
    })
    .strict(),
]);

export type DailyMaintenancePayload = z.infer<typeof DailyMaintenancePayloadSchema>;

interface DailyMaintenanceWorkflowBindings extends ReleaseGateBindings {
  OPS_WORKFLOW: Workflow<DailyMaintenancePayload>;
}

export interface DailyMaintenanceEnv extends AnalyticsBindings, DailyMaintenanceWorkflowBindings {
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
const ActiveDailyMaintenanceJobSchema = z
  .object({
    activationCursor: ActivationEventCursorSchema.nullable(),
    continuation: z.number().int().nonnegative(),
    day: DailyMaintenanceDaySchema,
    leaseToken: z.string().uuid(),
    phase: z.enum(["activation", "orphan-upload-cleanup"]),
    releaseVersionId: z.string().uuid(),
    scheduledAt: z.string().datetime({ offset: true }),
  })
  .strict();
const ClaimedDailyMaintenanceJobSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("lost") }).strict(),
  z.object({ job: ActiveDailyMaintenanceJobSchema, state: z.literal("active") }).strict(),
]);
type ActivationEventPageItem = z.infer<typeof ActivationEventPageItemsSchema>[number];
type GenerationOutcome = { job: DailyMaintenanceJobRecord; state: "continue" } | { state: "done" };
export async function processDailyMaintenance(
  env: DailyMaintenanceEnv,
  instanceId: string,
  payloadInput: DailyMaintenancePayload,
  step: WorkflowStep,
): Promise<void> {
  const payload = DailyMaintenancePayloadSchema.parse(payloadInput);
  assertDailyMaintenanceWorkflowIdentity(instanceId, payload);
  assertDailyMaintenanceRelease(env, payload);
  const lease = payloadLease(payload);
  try {
    const job = await loadCurrentJob(env, step, lease);
    if (!job) {
      return;
    }
    const outcome = await processDailyMaintenanceGeneration(env, step, job);
    if (outcome.state === "continue") {
      await continueDailyMaintenance(env, step, outcome.job);
    }
  } catch (error) {
    await deferWorkflowFailure(env, step, lease, error, "execution");
  }
}

async function processDailyMaintenanceGeneration(
  env: DailyMaintenanceEnv,
  step: WorkflowStep,
  job: DailyMaintenanceJobRecord,
): Promise<GenerationOutcome> {
  if (job.phase === "activation") {
    return processActivationGeneration(env, step, job);
  }
  const intents = await processOrphanUploadCleanupGeneration(env, step, job);
  if (intents.state !== "ready") {
    return intents;
  }
  await completeMaintenance(env, step, job, 1);
  return { state: "done" };
}

async function loadCurrentJob(
  env: DailyMaintenanceEnv,
  step: WorkflowStep,
  lease: DailyMaintenanceJobLease,
): Promise<DailyMaintenanceJobRecord | null> {
  const value = await step.do(
    "load daily maintenance generation lease",
    DB_STEP_OPTIONS,
    async () => {
      const claimed = await withDatabase(env, (db) => renewAndLoadDailyMaintenanceJob(db, lease));
      return claimed.state === "active"
        ? { job: jobToWire(claimed.job), state: "active" as const }
        : { state: "lost" as const };
    },
  );
  const claimed = ClaimedDailyMaintenanceJobSchema.parse(value);
  return claimed.state === "active" ? jobFromWire(claimed.job) : null;
}

async function processActivationGeneration(
  env: DailyMaintenanceEnv,
  step: WorkflowStep,
  initialJob: DailyMaintenanceJobRecord,
): Promise<GenerationOutcome> {
  let job = initialJob;
  for (let action = 1; action <= ACTIVATION_PAGES_PER_GENERATION; action += 1) {
    const page = await emitActivationPage(env, step, job, action);
    const next = page.nextCursor
      ? activationProgress(page.nextCursor)
      : orphanUploadCleanupProgress();
    const advanced = await persistProgress(env, step, job, next, action);
    if (!advanced) {
      return { state: "done" };
    }
    job = jobWithProgress(job, next);
    if (next.phase === "orphan-upload-cleanup") {
      return { job, state: "continue" };
    }
  }
  return { job, state: "continue" };
}

async function emitActivationPage(
  env: DailyMaintenanceEnv,
  step: WorkflowStep,
  job: DailyMaintenanceJobRecord,
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
  env: DailyMaintenanceEnv,
  step: WorkflowStep,
  job: DailyMaintenanceJobRecord,
  next: DailyMaintenanceJobProgress,
  action: number,
): Promise<boolean> {
  return step.do(`persist daily maintenance progress ${action}`, DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) =>
      advanceDailyMaintenanceJob(db, {
        ...jobLease(job),
        expected: jobProgress(job),
        next,
      }),
    ),
  );
}

async function completeMaintenance(
  env: DailyMaintenanceEnv,
  step: WorkflowStep,
  job: DailyMaintenanceJobRecord,
  action: number,
): Promise<void> {
  const completed = await step.do(`complete daily maintenance ${action}`, DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) =>
      completeDailyMaintenanceJob(db, { ...jobLease(job), expected: jobProgress(job) }),
    ),
  );
  if (completed) {
    createLogger().info("daily_maintenance_completed", {
      continuation: job.continuation,
      day: job.day,
    });
  }
}

async function continueDailyMaintenance(
  env: DailyMaintenanceEnv,
  step: WorkflowStep,
  job: DailyMaintenanceJobRecord,
): Promise<void> {
  assertReleaseCanDrain(env);
  const nextLeaseToken = await continuationLeaseToken(jobLease(job));
  const next = await step.do("reserve daily maintenance continuation", DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) =>
      reserveDailyMaintenanceContinuation(db, {
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
    await step.do("create daily maintenance continuation", CREATE_STEP_OPTIONS, () =>
      createDailyMaintenanceInstance(env, next),
    );
  } catch (error) {
    await deferWorkflowFailure(env, step, next, error, "continuation");
  }
}

async function deferWorkflowFailure(
  env: DailyMaintenanceEnv,
  step: WorkflowStep,
  lease: DailyMaintenanceJobLease,
  error: unknown,
  label: string,
): Promise<void> {
  const errorCode = dailyMaintenanceErrorCode(error);
  const deferred = await step.do(`${label} defer daily maintenance job`, DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) => deferDailyMaintenanceJob(db, { ...lease, errorCode })),
  );
  createLogger().warn("daily_maintenance_deferred", {
    continuation: lease.continuation,
    day: lease.day,
    errorCode,
    failureCount: deferred?.failureCount,
    label,
    ...safeErrorTelemetry(error),
  });
  emitErrorEvent(env, {
    errorCategory: "workflow",
    errorCode: "daily_maintenance_deferred",
    route: "daily-maintenance",
    workerName: "webhooks",
  });
}

export function createDailyMaintenanceInstance(
  env: DailyMaintenanceEnv,
  lease: DailyMaintenanceJobLease,
): Promise<DeterministicWorkflowResult> {
  const payload = dailyMaintenancePayload(lease);
  return createDeterministicWorkflow(env.OPS_WORKFLOW, {
    id: dailyMaintenanceWorkflowIdentity(payload),
    params: payload,
    retention: { errorRetention: "30 days", successRetention: "7 days" },
  });
}

function dailyMaintenancePayload(lease: DailyMaintenanceJobLease): DailyMaintenancePayload {
  return DailyMaintenancePayloadSchema.parse({
    ...lease,
    kind: "daily-maintenance",
    mode: lease.continuation === 0 ? "initial" : "continuation",
  });
}

function payloadLease(payload: DailyMaintenancePayload): DailyMaintenanceJobLease {
  return {
    continuation: payload.continuation,
    day: payload.day,
    leaseToken: payload.leaseToken,
    releaseVersionId: payload.releaseVersionId,
  };
}

function jobLease(job: DailyMaintenanceJobRecord): DailyMaintenanceJobLease {
  return {
    continuation: job.continuation,
    day: job.day,
    leaseToken: job.leaseToken,
    releaseVersionId: job.releaseVersionId,
  };
}

function jobProgress(job: DailyMaintenanceJobRecord): DailyMaintenanceJobProgress {
  return {
    activationCursor: job.activationCursor,
    phase: job.phase,
  };
}

function activationProgress(cursor: ActivationEventCursor): DailyMaintenanceJobProgress {
  return { activationCursor: cursor, phase: "activation" };
}

function orphanUploadCleanupProgress(): DailyMaintenanceJobProgress {
  return { activationCursor: null, phase: "orphan-upload-cleanup" };
}

function jobWithProgress(
  job: DailyMaintenanceJobRecord,
  progress: DailyMaintenanceJobProgress,
): DailyMaintenanceJobRecord {
  return { ...job, ...progress };
}

function jobToWire(
  job: DailyMaintenanceJobRecord,
): z.infer<typeof ActiveDailyMaintenanceJobSchema> {
  return {
    ...job,
    scheduledAt: job.scheduledAt.toISOString(),
  };
}

function jobFromWire(
  job: z.infer<typeof ActiveDailyMaintenanceJobSchema>,
): DailyMaintenanceJobRecord {
  return {
    ...job,
    scheduledAt: new Date(job.scheduledAt),
  };
}

function dailyMaintenanceWorkflowIdentity(payloadInput: DailyMaintenancePayload): string {
  const payload = DailyMaintenancePayloadSchema.parse(payloadInput);
  const id = [
    "dm",
    payload.day,
    payload.continuation,
    payload.releaseVersionId.replaceAll("-", ""),
    payload.leaseToken.replaceAll("-", ""),
  ].join("-");
  if (id.length > 100) {
    throw new Error(
      "Daily maintenance Workflow identity exceeded Cloudflare's 100-character limit",
    );
  }
  return id;
}

function assertDailyMaintenanceWorkflowIdentity(
  instanceId: string,
  payload: DailyMaintenancePayload,
): void {
  if (instanceId !== dailyMaintenanceWorkflowIdentity(payload)) {
    throw new NonRetryableError(
      "Daily maintenance Workflow identity does not match its immutable lease payload",
      "DailyMaintenanceWorkflowIdentityInvalid",
    );
  }
}

function assertDailyMaintenanceRelease(
  env: DailyMaintenanceEnv,
  payload: DailyMaintenancePayload,
): void {
  if (payload.releaseVersionId !== activeDailyMaintenanceReleaseVersion(env)) {
    throw new NonRetryableError(
      "Daily maintenance Workflow lease belongs to a different Worker release",
      "DailyMaintenanceWorkflowReleaseInvalid",
    );
  }
}

export function activeDailyMaintenanceReleaseVersion(env: DailyMaintenanceEnv): string {
  if (env.CHEATCODE_ENVIRONMENT !== "production") {
    return DEVELOPMENT_RELEASE_VERSION_ID;
  }
  return z.string().uuid().parse(env.CF_VERSION_METADATA?.id);
}

async function continuationLeaseToken(lease: DailyMaintenanceJobLease): Promise<string> {
  const input = new TextEncoder().encode(
    `daily-maintenance:${lease.day}:${lease.continuation + 1}:${lease.releaseVersionId}`,
  );
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", input)).slice(0, 16);
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("Daily maintenance continuation digest was incomplete");
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
    throw dailyMaintenanceInvariant(
      "Activation continuation cursor does not identify the page tail",
    );
  }
  if (items.length !== ACTIVATION_EVENT_PAGE_SIZE) {
    throw dailyMaintenanceInvariant("A continuing activation page must be full");
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
    throw dailyMaintenanceInvariant("Activation cursor did not advance in database key order");
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

function dailyMaintenanceErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9_.:$-]{0,127}$/u.test(name) ? name : "UnknownError";
}

function dailyMaintenanceInvariant(message: string): NonRetryableError {
  return new NonRetryableError(message, "DailyMaintenanceInvariantViolation");
}

async function withDatabase<T>(
  env: DailyMaintenanceEnv,
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
