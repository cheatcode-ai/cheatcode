import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getProviderKey, validateProviderKey } from "@cheatcode/byok";
import {
  type ActivationEventRecord,
  archiveUserProjects,
  claimUserDeletion,
  createDb,
  type Database,
  deleteExpiredGeneratedOutputs,
  disableProviderKey,
  type ExpiredGeneratedOutputCursor,
  type ExpiredGeneratedOutputRecord,
  type HyperdriveConnection,
  hardDeleteUserV2Data,
  listDailyActivationEvents,
  listExpiredGeneratedOutputs,
  listProviderKeyRevalidationTargets,
  listUserDeletionIntegrationPage,
  listUserDeletionRunPage,
  loadUserDeletionContext,
  purgeExpiredBillingEvents,
  type UserDeletionContext,
  type UserDeletionPage,
  withUserContext,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import {
  type AnalyticsBindings,
  APIError,
  createLogger,
  emitUserEvent,
} from "@cheatcode/observability";
import { type Provider, ProviderSchema, type UserId } from "@cheatcode/types";
import { z } from "zod";
import { runAnalyticsWatchdog } from "./analytics-watchdog";
import {
  deleteUserAgentAccountState,
  deleteUserAgentRunStatePage,
  deleteUserGatewayDurableState,
  deleteUserPolarBilling,
  deleteUserR2ObjectBatch,
  type LifecycleEnv,
  revokeUserComposioConnectionPage,
} from "./lifecycle-adapters";
import { createDeterministicWorkflow } from "./workflow-instance";

const OpsMaintenancePayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("analytics-watchdog"),
    scheduledTime: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("byok-revalidation"),
    limit: z.number().int().positive().max(1_000).default(250),
    scheduledTime: z.number().int().nonnegative(),
  }),
  z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.literal("retention-metrics"),
    scheduledTime: z.number().int().nonnegative(),
  }),
  z.object({
    graceUntil: z.number().int().positive(),
    kind: z.literal("user-deletion"),
    requestedAt: z.number().int().nonnegative(),
    userId: z.string().uuid(),
  }),
]);

export type OpsMaintenancePayload = z.infer<typeof OpsMaintenancePayloadSchema>;

export interface OpsWorkflowBindings {
  OPS_WORKFLOW: Workflow<OpsMaintenancePayload>;
}

interface OpsWorkflowEnv extends AnalyticsBindings, LifecycleEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_API_TOKEN?: WorkerSecret;
  HYPERDRIVE: HyperdriveConnection;
  INTERNAL_ALERT_WEBHOOK_SECRET?: WorkerSecret;
  INTERNAL_ALERT_WEBHOOK_URL?: string;
  R2_OUTPUTS_BUCKET_NAME?: string;
}

export class OpsMaintenanceWorkflow extends WorkflowEntrypoint<
  OpsWorkflowEnv,
  OpsMaintenancePayload
> {
  public override async run(
    event: Readonly<WorkflowEvent<OpsMaintenancePayload>>,
    step: WorkflowStep,
  ): Promise<{ kind: OpsMaintenancePayload["kind"]; ok: true }> {
    const payload = OpsMaintenancePayloadSchema.parse(event.payload);
    if (payload.kind === "user-deletion") {
      await processUserDeletion(this.env, payload, step);
      return { kind: payload.kind, ok: true };
    }
    if (payload.kind === "retention-metrics") {
      await processDailyRetention(this.env, payload, step);
      return { kind: payload.kind, ok: true };
    }
    await step.do(
      opsStepName(payload.kind),
      {
        retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
        timeout: "10 minutes",
      },
      async () => {
        await processOpsMaintenancePayload(this.env, payload);
        return { ok: true };
      },
    );
    return { kind: payload.kind, ok: true };
  }
}

export async function enqueueDailyRetentionMetrics(
  env: OpsWorkflowBindings,
  scheduledTime: number,
): Promise<string> {
  const day = previousUtcDay(new Date(scheduledTime));
  const instance = await createDeterministicWorkflow(env.OPS_WORKFLOW, {
    id: `retention-metrics-${day}`,
    params: { day, kind: "retention-metrics", scheduledTime },
    retention: {
      errorRetention: "30 days",
      successRetention: "7 days",
    },
  });
  return instance.id;
}

export async function enqueueAnalyticsWatchdog(
  env: OpsWorkflowBindings,
  scheduledTime: number,
): Promise<string> {
  const instance = await createDeterministicWorkflow(env.OPS_WORKFLOW, {
    id: `analytics-watchdog-${scheduledTime}`,
    params: { kind: "analytics-watchdog", scheduledTime },
    retention: {
      errorRetention: "30 days",
      successRetention: "7 days",
    },
  });
  return instance.id;
}

export async function enqueueByokRevalidation(
  env: OpsWorkflowBindings,
  scheduledTime: number,
): Promise<string> {
  const instance = await createDeterministicWorkflow(env.OPS_WORKFLOW, {
    id: `byok-revalidation-${previousUtcDay(new Date(scheduledTime))}`,
    params: { kind: "byok-revalidation", limit: 250, scheduledTime },
    retention: {
      errorRetention: "30 days",
      successRetention: "7 days",
    },
  });
  return instance.id;
}

export async function enqueueUserDeletionWorkflow(
  env: OpsWorkflowBindings,
  input: { requestedAt?: number; userId: UserId },
): Promise<string> {
  const requestedAt = input.requestedAt ?? Date.now();
  const graceUntil = requestedAt + 30 * 24 * 60 * 60 * 1000;
  const instance = await createDeterministicWorkflow(env.OPS_WORKFLOW, {
    id: `user-deletion-${input.userId}-${requestedAt}`,
    params: { graceUntil, kind: "user-deletion", requestedAt, userId: input.userId },
    retention: {
      errorRetention: "90 days",
      successRetention: "30 days",
    },
  });
  return instance.id;
}

async function processOpsMaintenancePayload(env: OpsWorkflowEnv, value: unknown): Promise<void> {
  const payload = OpsMaintenancePayloadSchema.parse(value);
  if (payload.kind === "analytics-watchdog") {
    await runAnalyticsWatchdog(env, payload.scheduledTime);
    return;
  }
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    if (payload.kind === "byok-revalidation") {
      const result = await revalidateProviderKeys(db, payload.limit);
      createLogger().info("byok_revalidation_inventory", {
        checked: result.checked,
        disabled: result.disabled,
        invalid: result.invalid,
        providers: result.providers,
        skipped: result.skipped,
      });
      return;
    }
    throw new APIError(400, "invalid_request_body", "Unsupported ops maintenance payload", {
      retriable: false,
    });
  } finally {
    await close();
  }
}

const BILLING_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_OUTPUTS_BUCKET_NAME = "cheatcode-outputs";
const EXPIRED_OUTPUT_MAX_PAGES = 100;
const EXPIRED_OUTPUT_PAGE_SIZE = 500;
const RETENTION_DB_STEP_OPTIONS = {
  retries: { limit: 3, delay: "20 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} as const;
const RETENTION_R2_STEP_OPTIONS = {
  retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
} as const;
const ExpiredOutputPageSchema = z.array(
  z
    .object({
      expiresAt: z.string().datetime({ offset: true }),
      id: z.string().uuid(),
      r2Bucket: z.string().min(1),
      r2Key: z.string().min(1),
    })
    .strict(),
);
type RetentionPayload = Extract<OpsMaintenancePayload, { kind: "retention-metrics" }>;
type ExpiredOutputWireRecord = z.infer<typeof ExpiredOutputPageSchema>[number];

async function processDailyRetention(
  env: OpsWorkflowEnv,
  payload: RetentionPayload,
  step: WorkflowStep,
): Promise<void> {
  await step.do("purge expired billing events", RETENTION_DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) =>
      purgeExpiredBillingEvents(db, new Date(payload.scheduledTime - BILLING_EVENT_RETENTION_MS)),
    ),
  );
  await step.do("emit daily activation metrics", RETENTION_DB_STEP_OPTIONS, async () => {
    const rows = await withDatabase(env, (db) =>
      listDailyActivationEvents(db, { day: payload.day }),
    );
    emitActivationEvents(env, rows);
    return { emitted: rows.length };
  });
  const cleanup = await cleanupExpiredOutputs(env, step, new Date(payload.scheduledTime));
  createLogger().info("expired_output_cleanup_completed", cleanup);
}

async function cleanupExpiredOutputs(
  env: OpsWorkflowEnv,
  step: WorkflowStep,
  cutoff: Date,
): Promise<{ backlog: boolean; objects: number; pages: number; rows: number; skipped: number }> {
  let cursor: ExpiredGeneratedOutputCursor | undefined;
  let objects = 0;
  let rows = 0;
  let skipped = 0;
  for (let pageNumber = 1; pageNumber <= EXPIRED_OUTPUT_MAX_PAGES; pageNumber += 1) {
    const page = await listExpiredOutputPage(env, step, cutoff, cursor, pageNumber);
    if (page.length === 0) {
      return { backlog: false, objects, pages: pageNumber - 1, rows, skipped };
    }
    const cleanup = await cleanupExpiredOutputPage(env, step, cutoff, page, pageNumber);
    objects += cleanup.objects;
    rows += cleanup.rows;
    skipped += cleanup.skipped;
    cursor = outputCursor(page.at(-1));
    if (page.length < EXPIRED_OUTPUT_PAGE_SIZE) {
      return { backlog: false, objects, pages: pageNumber, rows, skipped };
    }
  }
  return { backlog: true, objects, pages: EXPIRED_OUTPUT_MAX_PAGES, rows, skipped };
}

async function listExpiredOutputPage(
  env: OpsWorkflowEnv,
  step: WorkflowStep,
  cutoff: Date,
  cursor: ExpiredGeneratedOutputCursor | undefined,
  pageNumber: number,
): Promise<ExpiredOutputWireRecord[]> {
  const value = await step.do(
    `list expired outputs page ${pageNumber}`,
    RETENTION_DB_STEP_OPTIONS,
    () =>
      withDatabase(env, async (db) => {
        const records = await listExpiredGeneratedOutputs(db, {
          before: cutoff,
          ...(cursor ? { cursor } : {}),
          limit: EXPIRED_OUTPUT_PAGE_SIZE,
        });
        return records.map(outputToWireRecord);
      }),
  );
  return ExpiredOutputPageSchema.max(EXPIRED_OUTPUT_PAGE_SIZE).parse(value);
}

async function cleanupExpiredOutputPage(
  env: OpsWorkflowEnv,
  step: WorkflowStep,
  cutoff: Date,
  page: ExpiredOutputWireRecord[],
  pageNumber: number,
): Promise<{ objects: number; rows: number; skipped: number }> {
  const bucketName = env.R2_OUTPUTS_BUCKET_NAME?.trim() || DEFAULT_OUTPUTS_BUCKET_NAME;
  const matching = page.filter((output) => output.r2Bucket === bucketName);
  const skipped = page.length - matching.length;
  if (skipped > 0) {
    createLogger().error("expired_output_bucket_mismatch", {
      configuredBucket: bucketName,
      page: pageNumber,
      skipped,
      storedBuckets: [...new Set(page.map((output) => output.r2Bucket))].sort(),
    });
  }
  if (matching.length === 0) {
    return { objects: 0, rows: 0, skipped };
  }
  const objectKeys = [...new Set(matching.map((output) => output.r2Key))];
  await step.do(
    `delete expired output objects page ${pageNumber}`,
    RETENTION_R2_STEP_OPTIONS,
    async () => {
      await env.R2_OUTPUTS.delete(objectKeys);
      return { deleted: objectKeys.length };
    },
  );
  const records = matching.map(outputFromWireRecord);
  const rows = await step.do(
    `delete expired output rows page ${pageNumber}`,
    RETENTION_DB_STEP_OPTIONS,
    () =>
      withDatabase(env, (db) =>
        deleteExpiredGeneratedOutputs(db, { before: cutoff, outputs: records }),
      ),
  );
  return { objects: objectKeys.length, rows, skipped };
}

function outputToWireRecord(output: ExpiredGeneratedOutputRecord): ExpiredOutputWireRecord {
  return { ...output, expiresAt: output.expiresAt.toISOString() };
}

function outputFromWireRecord(output: ExpiredOutputWireRecord): ExpiredGeneratedOutputRecord {
  return { ...output, expiresAt: new Date(output.expiresAt) };
}

function outputCursor(output: ExpiredOutputWireRecord | undefined): ExpiredGeneratedOutputCursor {
  if (!output) {
    throw new Error("Expired output page cursor is missing");
  }
  return { expiresAt: new Date(output.expiresAt), id: output.id };
}

function emitActivationEvents(env: AnalyticsBindings, rows: ActivationEventRecord[]): void {
  for (const row of rows) {
    emitUserEvent(env, {
      ...(row.cohortMonth ? { cohortMonth: row.cohortMonth } : {}),
      ...(row.cohortWeek ? { cohortWeek: row.cohortWeek } : {}),
      eventName: row.eventName,
      userId: row.userId,
    });
  }
}

async function revalidateProviderKeys(
  db: Database,
  limit: number,
): Promise<{
  checked: number;
  disabled: number;
  invalid: number;
  providers: string[];
  skipped: number;
}> {
  const targets = await listProviderKeyRevalidationTargets(db, limit);
  const providers = new Set<string>();
  let checked = 0;
  let disabled = 0;
  let invalid = 0;
  let skipped = 0;
  for (const target of targets) {
    const parsedProvider = ProviderSchema.safeParse(target.provider);
    if (!parsedProvider.success) {
      skipped += 1;
      continue;
    }
    providers.add(parsedProvider.data);
    const outcome = await revalidateOneProviderKey(db, target.userId, parsedProvider.data);
    checked += outcome.checked;
    disabled += outcome.disabled;
    invalid += outcome.invalid;
  }
  return { checked, disabled, invalid, providers: [...providers].sort(), skipped };
}

async function revalidateOneProviderKey(
  db: Database,
  userId: UserId,
  provider: Provider,
): Promise<{ checked: number; disabled: number; invalid: number }> {
  return withUserContext(db, userId, async (tx) => {
    const key = await getProviderKey(tx, provider);
    if (!key) {
      return { checked: 0, disabled: 0, invalid: 0 };
    }
    try {
      await validateProviderKey(provider, key);
      return { checked: 1, disabled: 0, invalid: 0 };
    } catch (error) {
      if (isInvalidProviderKeyError(error)) {
        const disabled = await disableProviderKey(tx, {
          provider,
          reason: "revalidation_invalid",
          userId,
        });
        return { checked: 1, disabled: disabled ? 1 : 0, invalid: 1 };
      }
      throw error;
    }
  });
}

function isInvalidProviderKeyError(error: unknown): boolean {
  return error instanceof APIError && error.code === "byok_key_invalid";
}

async function processUserDeletion(
  env: OpsWorkflowEnv,
  payload: Extract<OpsMaintenancePayload, { kind: "user-deletion" }>,
  step: WorkflowStep,
): Promise<void> {
  await step.sleepUntil("wait for user deletion grace period", payload.graceUntil);
  const deletionFence = String(payload.requestedAt);
  const userId = payload.userId as UserId;
  const isClaimed = await claimDeletionGeneration(env, step, payload, deletionFence);
  if (!isClaimed) {
    createLogger({ userId: payload.userId }).info("user_deletion_cancelled", {
      reason: "deletion_generation_changed_before_claim",
    });
    return;
  }
  const context = await loadDeletionContextStep(env, step, userId, deletionFence);
  await deleteRunStatePages(env, step, userId, deletionFence);
  // Abort and join every AgentRun before destroying the shared sandbox. Otherwise a
  // still-running coroutine can recreate Daytona state after account cleanup.
  await deleteSharedUserResources(env, step, context);
  await deleteIntegrationPages(env, step, userId, deletionFence);
  await deleteR2Batches(step, env.R2_OUTPUTS, userId, "output objects");
  await deleteR2Batches(step, env.R2_UPLOADS, userId, "upload objects");
  await archiveAndFinalizeUser(env, step, context);
}

const DELETION_PAGE_SIZE = 500;
const DELETION_DB_STEP_OPTIONS = {
  retries: { limit: 3, delay: "20 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} as const;
const DELETION_EXTERNAL_STEP_OPTIONS = {
  retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
  timeout: "15 minutes",
} as const;

async function claimDeletionGeneration(
  env: OpsWorkflowEnv,
  step: WorkflowStep,
  payload: Extract<OpsMaintenancePayload, { kind: "user-deletion" }>,
  deletionFence: string,
): Promise<boolean> {
  return step.do("claim user deletion generation", DELETION_DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) =>
      claimUserDeletion(db, payload.userId as UserId, new Date(payload.requestedAt), deletionFence),
    ),
  );
}

async function loadDeletionContextStep(
  env: OpsWorkflowEnv,
  step: WorkflowStep,
  userId: UserId,
  deletionFence: string,
): Promise<UserDeletionContext> {
  return step.do("load user deletion context", DELETION_DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) => loadUserDeletionContext(db, userId, deletionFence)),
  );
}

async function deleteSharedUserResources(
  env: OpsWorkflowEnv,
  step: WorkflowStep,
  context: UserDeletionContext,
): Promise<void> {
  await deletionExternalStep(step, "delete user billing resources", () =>
    deleteUserPolarBilling(env, context),
  );
  await deletionExternalStep(step, "delete user sandbox durable state", () =>
    deleteUserAgentAccountState(env, context.userId),
  );
  // Sandbox teardown records its final usage checkpoint. Delete quota state only
  // after that writer has been permanently fenced and joined.
  await deletionExternalStep(step, "delete user gateway durable state", () =>
    deleteUserGatewayDurableState(env, context.userId),
  );
}

async function deleteRunStatePages(
  env: OpsWorkflowEnv,
  step: WorkflowStep,
  userId: UserId,
  deletionFence: string,
): Promise<void> {
  await processDeletionPages(
    step,
    "run durable state",
    (cursor) =>
      withDatabase(env, (db) =>
        listUserDeletionRunPage(db, {
          ...(cursor ? { cursor } : {}),
          deletionFence,
          limit: DELETION_PAGE_SIZE,
          userId,
        }),
      ),
    (items) => deleteUserAgentRunStatePage(env, userId, items),
  );
}

async function deleteIntegrationPages(
  env: OpsWorkflowEnv,
  step: WorkflowStep,
  userId: UserId,
  deletionFence: string,
): Promise<void> {
  await processDeletionPages(
    step,
    "Composio connections",
    (cursor) =>
      withDatabase(env, (db) =>
        listUserDeletionIntegrationPage(db, {
          ...(cursor ? { cursor } : {}),
          deletionFence,
          limit: DELETION_PAGE_SIZE,
          userId,
        }),
      ),
    (items) => revokeUserComposioConnectionPage(env, items),
  );
}

async function processDeletionPages(
  step: WorkflowStep,
  label: string,
  load: (cursor: string | undefined) => Promise<UserDeletionPage>,
  remove: (items: string[]) => Promise<unknown>,
): Promise<void> {
  let cursor: string | undefined;
  let pageNumber = 1;
  do {
    const page = await step.do(
      `load user ${label} page ${pageNumber}`,
      DELETION_DB_STEP_OPTIONS,
      () => load(cursor),
    );
    await deletionExternalStep(step, `delete user ${label} page ${pageNumber}`, () =>
      remove(page.items),
    );
    assertDeletionCursorAdvanced(cursor, page.nextCursor);
    cursor = page.nextCursor ?? undefined;
    pageNumber += 1;
  } while (cursor);
}

function assertDeletionCursorAdvanced(previous: string | undefined, next: string | null): void {
  if (next && next === previous) {
    throw new Error("User deletion page cursor did not advance");
  }
}

async function deleteR2Batches(
  step: WorkflowStep,
  bucket: R2Bucket,
  userId: UserId,
  label: string,
): Promise<void> {
  let batchNumber = 1;
  let hasMore: boolean;
  do {
    const result = await step.do(
      `delete user ${label} batch ${batchNumber}`,
      DELETION_EXTERNAL_STEP_OPTIONS,
      () => deleteUserR2ObjectBatch(bucket, userId),
    );
    hasMore = result.hasMore;
    batchNumber += 1;
  } while (hasMore);
}

async function archiveAndFinalizeUser(
  env: OpsWorkflowEnv,
  step: WorkflowStep,
  context: UserDeletionContext,
): Promise<void> {
  await step.do("archive user projects", DELETION_DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) => archiveUserProjects(db, context.userId, context.deletionFence)),
  );
  await step.do(
    "hard delete user v2 data",
    { retries: { limit: 5, delay: "1 minute", backoff: "exponential" }, timeout: "10 minutes" },
    () =>
      withDatabase(env, (db) =>
        hardDeleteUserV2Data(db, context.userId, context.deletionFence, context.clerkIdentityHash),
      ),
  );
}

async function deletionExternalStep(
  step: WorkflowStep,
  name: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  await step.do(name, DELETION_EXTERNAL_STEP_OPTIONS, async () => {
    await operation();
    return { ok: true };
  });
}

async function withDatabase<T>(
  env: OpsWorkflowEnv,
  operation: (db: Database) => Promise<T>,
): Promise<T> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    return await operation(db);
  } finally {
    await close();
  }
}

function previousUtcDay(now: Date): string {
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  startOfToday.setUTCDate(startOfToday.getUTCDate() - 1);
  return startOfToday.toISOString().slice(0, 10);
}

function opsStepName(kind: OpsMaintenancePayload["kind"]): string {
  if (kind === "byok-revalidation") {
    return "inventory BYOK keys for revalidation";
  }
  return "run analytics watchdog";
}
