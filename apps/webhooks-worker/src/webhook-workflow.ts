import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { updateCustomerProfile } from "@cheatcode/billing";
import {
  createDb,
  type Database,
  type HyperdriveConnection,
  markClerkUserDeleted,
  syncClerkUser,
  withUserContext,
} from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import {
  type AnalyticsBindings,
  APIError,
  createLogger,
  emitUserEvent,
} from "@cheatcode/observability";
import {
  type BillingTier,
  BillingTierSchema,
  billingTierRank,
  UserId as toUserId,
  type UserId,
} from "@cheatcode/types";
import type { WebhookEvent } from "@clerk/backend/webhooks";
import { z } from "zod";
import { handleClerkWebhookEvent } from "./clerk";
import { handleComposioWebhookEvent } from "./composio";
import { DaytonaWebhookSchema } from "./daytona";
import { refreshEntitlementCache } from "./entitlement-cache";
import { recordInternalAlert, VerifiedInternalAlertSchema } from "./internal-alert";
import { handlePolarWebhookEvent } from "./polar";
import { assertReleaseOpen, type ReleaseGateBindings } from "./release-gate";
import {
  completeWebhookEvent,
  failWebhookEvent,
  startWebhookEvent,
  updateDaytonaSandboxState,
  type WebhookIdempotencyBindings,
  type WebhookProvider,
  WebhookProviderSchema,
} from "./webhook-idempotency";
import { createDeterministicWorkflow, type DeterministicWorkflowResult } from "./workflow-instance";

const WebhookWorkflowPayloadSchema = z.object({
  acceptedAt: z.number().int().nonnegative(),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  event: z.unknown(),
  eventId: z.string().min(1).max(512),
  provider: WebhookProviderSchema,
});

export type WebhookWorkflowPayload = z.infer<typeof WebhookWorkflowPayloadSchema>;

export interface WebhookWorkflowBindings extends ReleaseGateBindings {
  WEBHOOK_WORKFLOW: Workflow<WebhookWorkflowPayload>;
}

interface WebhookWorkflowEnv extends AnalyticsBindings, WebhookIdempotencyBindings {
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
  ENTITLEMENTS_CACHE: KVNamespace;
  HYPERDRIVE: HyperdriveConnection;
  POLAR_ACCESS_TOKEN?: WorkerSecret;
  POLAR_PRODUCT_ID_MAX?: string;
  POLAR_PRODUCT_ID_PREMIUM?: string;
  POLAR_PRODUCT_ID_PRO?: string;
  POLAR_PRODUCT_ID_ULTRA?: string;
  POLAR_SERVER?: "production" | "sandbox";
}

const WebhookActionResultSchema = z
  .object({
    action: z.string().min(1),
    displayName: z.string().nullable().optional(),
    email: z.string().min(1).optional(),
    eventType: z.string().min(1),
    polarCustomerId: z.string().nullable().optional(),
    previousTier: BillingTierSchema.optional(),
    tier: BillingTierSchema.optional(),
    userId: z.string().uuid().transform(toUserId).optional(),
  })
  .strip();

type WebhookActionResult = z.infer<typeof WebhookActionResultSchema>;

const WEBHOOK_RETRY_OPTIONS = {
  retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
  timeout: "5 minutes",
} as const;

export interface WebhookProcessResult {
  action: string;
  eventType: string;
  provider: WebhookWorkflowPayload["provider"];
  tier?: string;
  userId?: UserId;
}

export class WebhookWorkflow extends WorkflowEntrypoint<
  WebhookWorkflowEnv,
  WebhookWorkflowPayload
> {
  public override async run(
    event: Readonly<WorkflowEvent<WebhookWorkflowPayload>>,
    step: WorkflowStep,
  ): Promise<WebhookProcessResult> {
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      throw new NonRetryableError(
        "Webhook processing is fenced by a closed release",
        "WebhookReleaseGateClosed",
      );
    }
    const payload = WebhookWorkflowPayloadSchema.parse(event.payload);
    try {
      await step.do("mark webhook running", async () => {
        await startWebhookEvent(this.env, webhookStateInput(payload, event.instanceId));
        return { ok: true };
      });
      const actionResult = await step.do(
        "persist verified webhook",
        WEBHOOK_RETRY_OPTIONS,
        async () => persistWebhookPayload(this.env, payload),
      );
      // The provider result is durable before derived effects. A retry therefore
      // cannot mistake an idempotent database no-op for evidence that they ran.
      await applyDerivedWebhookEffects(this.env, step, payload, actionResult);
      await step.do("mark webhook processed", async () => {
        await completeWebhookEvent(this.env, webhookStateInput(payload, event.instanceId));
        return { ok: true };
      });
      return toWebhookProcessResult(payload.provider, actionResult, actionResult.tier);
    } catch (error) {
      await recordTerminalWebhookFailure(this.env, step, payload, event.instanceId, error);
      throw error;
    }
  }
}

export async function enqueueVerifiedWebhook(
  env: WebhookWorkflowBindings,
  payload: WebhookWorkflowPayload,
): Promise<DeterministicWorkflowResult> {
  assertReleaseOpen(env);
  const parsed = WebhookWorkflowPayloadSchema.parse(payload);
  return createDeterministicWorkflow(env.WEBHOOK_WORKFLOW, {
    id: webhookWorkflowId(parsed),
    params: parsed,
    retention: {
      errorRetention: "30 days",
      successRetention: "7 days",
    },
  });
}

async function persistWebhookPayload(
  env: WebhookWorkflowEnv,
  value: unknown,
): Promise<WebhookActionResult> {
  const payload = WebhookWorkflowPayloadSchema.parse(value);
  const infrastructureResult = await processInfrastructureWebhook(env, payload);
  if (infrastructureResult) {
    return WebhookActionResultSchema.parse(infrastructureResult);
  }
  return processDatabaseWebhook(env, payload);
}

async function processDatabaseWebhook(
  env: WebhookWorkflowEnv,
  payload: WebhookWorkflowPayload,
): Promise<WebhookActionResult> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_webhooks",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS,
  });
  try {
    const result = await processProviderWebhook(db, env, payload);
    return WebhookActionResultSchema.parse(result);
  } finally {
    await close();
  }
}

async function applyDerivedWebhookEffects(
  env: WebhookWorkflowEnv,
  step: WorkflowStep,
  payload: WebhookWorkflowPayload,
  result: WebhookActionResult,
): Promise<void> {
  const userId = result.userId;
  if (userId && (payload.provider === "clerk" || payload.provider === "polar")) {
    await step.do("refresh webhook entitlement cache", WEBHOOK_RETRY_OPTIONS, async () => {
      await refreshWebhookEntitlementCache(env, userId);
      return { ok: true };
    });
  }
  if (payload.provider === "clerk") {
    await step.do("sync clerk profile to Polar", WEBHOOK_RETRY_OPTIONS, async () => {
      await syncPolarCustomerFromClerkUpdate(env, result);
      return { ok: true };
    });
  }
  if (userId && (payload.provider === "clerk" || payload.provider === "polar")) {
    await step.do("emit webhook analytics", async () => {
      emitWebhookAnalytics(env, payload, result);
      return { ok: true };
    });
  }
}

async function refreshWebhookEntitlementCache(
  env: WebhookWorkflowEnv,
  userId: UserId,
): Promise<void> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_webhooks",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS,
  });
  try {
    await withUserContext(db, userId, (tx) =>
      refreshEntitlementCache(tx, env.ENTITLEMENTS_CACHE, userId),
    );
  } finally {
    await close();
  }
}

function emitWebhookAnalytics(
  env: WebhookWorkflowEnv,
  payload: WebhookWorkflowPayload,
  result: WebhookActionResult,
): void {
  if (
    result.userId &&
    payload.provider === "clerk" &&
    result.eventType === "user.created" &&
    result.action !== "stale_event_ignored"
  ) {
    emitUserEvent(env, {
      authMethod: authMethodFromClerkEvent(payload.event),
      eventId: payload.eventId,
      eventName: "signup_completed",
      userId: result.userId,
    });
  }
  emitPolarBillingEvents(env, payload.provider, payload.eventId, result, result.tier);
}

async function processInfrastructureWebhook(
  env: WebhookWorkflowEnv,
  payload: WebhookWorkflowPayload,
): Promise<WebhookActionResult | null> {
  if (payload.provider === "daytona") {
    const event = DaytonaWebhookSchema.parse(payload.event);
    const updated = await updateDaytonaSandboxState(env, {
      sandboxId: event.id,
      state: event.newState.toLowerCase(),
      updatedAt: Date.parse(event.updatedAt),
    });
    return { action: updated ? "state_cached" : "stale_event_ignored", eventType: event.event };
  }
  if (payload.provider === "internal-alert") {
    const alert = VerifiedInternalAlertSchema.parse(payload.event);
    recordInternalAlert(env, alert);
    return { action: "alert_recorded", eventType: alert.source };
  }
  return null;
}

async function processProviderWebhook(
  db: Database,
  env: WebhookWorkflowEnv,
  payload: WebhookWorkflowPayload,
) {
  if (payload.provider === "clerk") {
    return handleClerkWebhookEvent(
      {
        markUserDeleted: (clerkId, deletedAt) => markClerkUserDeleted(db, clerkId, deletedAt),
        syncUser: (input) => syncClerkUser(db, input),
      },
      payload.event as WebhookEvent,
      new Date(payload.acceptedAt),
    );
  }
  if (payload.provider === "polar") {
    return handlePolarWebhookEvent(db, {
      accessToken: await polarAccessToken(env),
      event: payload.event,
      productTierById: polarProductTierById(env),
      ...(env.POLAR_SERVER ? { server: env.POLAR_SERVER } : {}),
    });
  }
  if (payload.provider === "composio") {
    return db.transaction((tx) => handleComposioWebhookEvent(tx as Database, payload.event));
  }
  throw new APIError(400, "invalid_request_body", "Unsupported webhook provider", {
    retriable: false,
  });
}

function toWebhookProcessResult(
  provider: WebhookProvider,
  result: WebhookActionResult,
  tier?: string,
): WebhookProcessResult {
  return {
    action: result.action,
    eventType: result.eventType,
    provider,
    ...(tier ? { tier } : {}),
    ...(result.userId ? { userId: result.userId } : {}),
  };
}

function webhookStateInput(
  payload: WebhookWorkflowPayload,
  workflowId: string,
): { bodyHash: string; eventId: string; provider: WebhookProvider; workflowId: string } {
  return {
    bodyHash: payload.bodyHash,
    eventId: payload.eventId,
    provider: payload.provider,
    workflowId,
  };
}

async function recordTerminalWebhookFailure(
  env: WebhookWorkflowEnv,
  step: WorkflowStep,
  payload: WebhookWorkflowPayload,
  workflowId: string,
  error: unknown,
): Promise<void> {
  const failureCode = error instanceof APIError ? error.code : "webhook_processing_failed";
  try {
    await step.do("mark webhook failed", async () => {
      await failWebhookEvent(env, {
        ...webhookStateInput(payload, workflowId),
        failureCode,
      });
      return { ok: true };
    });
    createLogger().error("webhook_moved_to_dlq", {
      eventId: payload.eventId,
      failureCode,
      provider: payload.provider,
      workflowId,
    });
  } catch {
    createLogger().error("webhook_failure_state_write_failed", {
      eventId: payload.eventId,
      failureCode,
      provider: payload.provider,
      workflowId,
    });
  }
}

function emitPolarBillingEvents(
  env: WebhookWorkflowEnv,
  provider: WebhookWorkflowPayload["provider"],
  eventId: string,
  result: WebhookActionResult,
  tier: string | undefined,
): void {
  if (!result.userId || provider !== "polar") {
    return;
  }
  if (shouldEmitFirstPaid(result, tier)) {
    emitUserEvent(env, {
      eventId,
      eventName: "first_paid",
      plan: tier,
      userId: result.userId,
    });
  }
  if (shouldEmitTierUpgraded(result, tier)) {
    const fromPlan = previousTier(result);
    emitUserEvent(env, {
      eventId,
      eventName: "tier_upgraded",
      ...(fromPlan ? { fromPlan } : {}),
      toPlan: tier,
      userId: result.userId,
    });
  }
}

async function syncPolarCustomerFromClerkUpdate(
  env: WebhookWorkflowEnv,
  result: WebhookActionResult,
): Promise<void> {
  // An equal-version replay can mean the database committed immediately before
  // the Workflow checkpoint was lost. Reapply this idempotent projection too.
  if (
    result.eventType !== "user.updated" ||
    result.action === "stale_event_ignored" ||
    !result.email ||
    !result.polarCustomerId
  ) {
    return;
  }
  await updateCustomerProfile({
    accessToken: await polarAccessToken(env),
    customerId: result.polarCustomerId,
    email: result.email,
    ...(result.displayName !== undefined ? { name: result.displayName } : {}),
    ...(env.POLAR_SERVER ? { server: env.POLAR_SERVER } : {}),
  });
}

async function polarAccessToken(env: WebhookWorkflowEnv): Promise<string> {
  let token: string | undefined;
  try {
    token = await resolveWorkerSecret(env.POLAR_ACCESS_TOKEN);
  } catch {
    throw new APIError(503, "unavailable_maintenance", "POLAR_ACCESS_TOKEN is unavailable", {
      hint: "Verify the POLAR_ACCESS_TOKEN Cloudflare Secrets Store binding and secret value.",
      retriable: false,
    });
  }
  if (!token) {
    throw new APIError(503, "unavailable_maintenance", "Polar access token is not configured", {
      hint: "Set POLAR_ACCESS_TOKEN on the webhooks Worker.",
      retriable: false,
    });
  }
  return token;
}

function polarProductTierById(env: WebhookWorkflowEnv): Readonly<Record<string, BillingTier>> {
  const entries: Array<[string, BillingTier]> = [];
  appendProductTier(entries, env.POLAR_PRODUCT_ID_PRO, "pro");
  appendProductTier(entries, env.POLAR_PRODUCT_ID_PREMIUM, "premium");
  appendProductTier(entries, env.POLAR_PRODUCT_ID_ULTRA, "ultra");
  appendProductTier(entries, env.POLAR_PRODUCT_ID_MAX, "max");
  return Object.fromEntries(entries);
}

function appendProductTier(
  entries: Array<[string, BillingTier]>,
  productId: string | undefined,
  tier: BillingTier,
): void {
  const normalized = productId?.trim();
  if (normalized) {
    entries.push([normalized, tier]);
  }
}

function authMethodFromClerkEvent(event: unknown): string {
  const data = eventData(event);
  if (Array.isArray(data?.["external_accounts"]) && data["external_accounts"].length > 0) {
    return "oauth";
  }
  if (Array.isArray(data?.["phone_numbers"]) && data["phone_numbers"].length > 0) {
    return "phone";
  }
  if (Array.isArray(data?.["email_addresses"]) && data["email_addresses"].length > 0) {
    return "email";
  }
  return "unknown";
}

function eventData(event: unknown): Record<string, unknown> | undefined {
  if (!event || typeof event !== "object") {
    return undefined;
  }
  const data = (event as Record<string, unknown>)["data"];
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : undefined;
}

function previousTier(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const tier = (result as Record<string, unknown>)["previousTier"];
  return typeof tier === "string" ? tier : undefined;
}

function shouldEmitFirstPaid(
  result: {
    action: string;
    eventType: string;
  },
  tier: string | undefined,
): tier is string {
  return (
    result.eventType === "subscription.created" &&
    result.action === "entitlement_synced" &&
    Boolean(tier && tier !== "free")
  );
}

function shouldEmitTierUpgraded(
  result: {
    action: string;
  },
  tier: string | undefined,
): tier is string {
  const from = previousTier(result);
  return result.action === "entitlement_synced" && billingTierRank(tier) > billingTierRank(from);
}

function webhookWorkflowId(payload: WebhookWorkflowPayload): string {
  return `webhook-${payload.provider}-${payload.bodyHash.slice(0, 32)}`;
}
