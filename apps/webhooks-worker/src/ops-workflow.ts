import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getProviderKey, validateProviderKey } from "@cheatcode/byok";
import {
  type ActivationEventRecord,
  archiveUserProjects,
  buildUserDeletionManifest,
  createDb,
  type Database,
  disableProviderKey,
  type HyperdriveConnection,
  hardDeleteUserV2Data,
  listDailyActivationEvents,
  listProviderKeyRevalidationTargets,
  rollupUsageDailyTotals,
  type UsageDailyTotalRecord,
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
import { deleteUserExternalResources, type LifecycleEnv } from "./lifecycle-adapters";

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
    kind: z.literal("usage-rollup"),
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

export async function enqueueDailyUsageRollup(
  env: OpsWorkflowBindings,
  scheduledTime: number,
): Promise<string> {
  const day = previousUtcDay(new Date(scheduledTime));
  const instance = await env.OPS_WORKFLOW.create({
    id: `usage-rollup-${day}-${crypto.randomUUID()}`,
    params: { day, kind: "usage-rollup" },
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
  const instance = await env.OPS_WORKFLOW.create({
    id: `analytics-watchdog-${scheduledTime}-${crypto.randomUUID()}`,
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
  const instance = await env.OPS_WORKFLOW.create({
    id: `byok-revalidation-${previousUtcDay(new Date(scheduledTime))}-${crypto.randomUUID()}`,
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
  const instance = await env.OPS_WORKFLOW.create({
    id: `user-deletion-${input.userId}-${requestedAt}`,
    params: { graceUntil, kind: "user-deletion", requestedAt, userId: input.userId },
    retention: {
      errorRetention: "90 days",
      successRetention: "30 days",
    },
  });
  return instance.id;
}

export async function processOpsMaintenancePayload(
  env: OpsWorkflowEnv,
  value: unknown,
): Promise<void> {
  const payload = OpsMaintenancePayloadSchema.parse(value);
  if (payload.kind === "analytics-watchdog") {
    await runAnalyticsWatchdog(env);
    return;
  }
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    if (payload.kind === "usage-rollup") {
      const rows = await rollupUsageDailyTotals(db, { day: payload.day });
      emitCostAggregatedDailyEvents(env, rows);
      emitActivationEvents(env, await listDailyActivationEvents(db, { day: payload.day }));
      return;
    }
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

function emitCostAggregatedDailyEvents(
  env: AnalyticsBindings,
  rows: UsageDailyTotalRecord[],
): void {
  for (const row of rows) {
    emitUserEvent(env, {
      cacheReadTokens: row.totalCachedTokens,
      eventDate: row.day,
      eventName: "cost_aggregated_daily",
      tokensIn: row.totalInputTokens,
      tokensOut: row.totalOutputTokens,
      tokensUsed: row.totalInputTokens + row.totalOutputTokens,
      userId: row.userId,
      valueUsdMicros: Math.round(Number.parseFloat(row.totalCostUsd) * 1_000_000),
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
  const manifest = await step.do(
    "build user deletion manifest",
    { retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }, timeout: "2 minutes" },
    async () => {
      const { db, close } = createDb(env.HYPERDRIVE);
      try {
        return await buildUserDeletionManifest(db, payload.userId as UserId);
      } finally {
        await close();
      }
    },
  );

  await step.do(
    "delete user external resources",
    { retries: { limit: 5, delay: "30 seconds", backoff: "exponential" }, timeout: "15 minutes" },
    async () => deleteUserExternalResources({ env, manifest }),
  );

  await step.do(
    "archive user projects",
    { retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }, timeout: "2 minutes" },
    async () => {
      const { db, close } = createDb(env.HYPERDRIVE);
      try {
        return await archiveUserProjects(db, payload.userId as UserId);
      } finally {
        await close();
      }
    },
  );

  await step.sleepUntil("wait for user deletion grace period", payload.graceUntil);

  await step.do(
    "hard delete user v2 data",
    { retries: { limit: 5, delay: "1 minute", backoff: "exponential" }, timeout: "10 minutes" },
    async () => {
      const { db, close } = createDb(env.HYPERDRIVE);
      try {
        return await hardDeleteUserV2Data(db, payload.userId as UserId);
      } finally {
        await close();
      }
    },
  );
}

function previousUtcDay(now: Date): string {
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  startOfToday.setUTCDate(startOfToday.getUTCDate() - 1);
  return startOfToday.toISOString().slice(0, 10);
}

function opsStepName(kind: OpsMaintenancePayload["kind"]): string {
  if (kind === "usage-rollup") {
    return "roll up usage daily totals";
  }
  if (kind === "byok-revalidation") {
    return "inventory BYOK keys for revalidation";
  }
  return "run analytics watchdog";
}
