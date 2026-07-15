import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { updateCustomerProfile } from "@cheatcode/billing";
import {
  createDb,
  type Database,
  type HyperdriveConnection,
  markClerkUserDeleted,
  upsertClerkUser,
} from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import {
  type AnalyticsBindings,
  APIError,
  createLogger,
  emitUserEvent,
} from "@cheatcode/observability";
import { type BillingTier, billingTierRank, type UserId } from "@cheatcode/types";
import type { WebhookEvent } from "@clerk/backend/webhooks";
import { z } from "zod";
import { handleClerkWebhookEvent } from "./clerk";
import { handleComposioWebhookEvent } from "./composio";
import { DaytonaWebhookSchema } from "./daytona";
import { refreshEntitlementCache } from "./entitlement-cache";
import { recordInternalAlert, VerifiedInternalAlertSchema } from "./internal-alert";
import { enqueueUserDeletionWorkflow, type OpsWorkflowBindings } from "./ops-workflow";
import { handlePolarWebhookEvent } from "./polar";
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

export interface WebhookWorkflowBindings {
  WEBHOOK_WORKFLOW: Workflow<WebhookWorkflowPayload>;
}

interface WebhookWorkflowEnv
  extends AnalyticsBindings,
    OpsWorkflowBindings,
    WebhookIdempotencyBindings {
  ENTITLEMENTS_CACHE: KVNamespace;
  HYPERDRIVE: HyperdriveConnection;
  POLAR_ACCESS_TOKEN?: WorkerSecret;
  POLAR_PRODUCT_ID_MAX?: string;
  POLAR_PRODUCT_ID_PREMIUM?: string;
  POLAR_PRODUCT_ID_PRO?: string;
  POLAR_PRODUCT_ID_ULTRA?: string;
  POLAR_SERVER?: "production" | "sandbox";
}

type BillingEventCandidate = {
  action: string;
  eventType: string;
  userId?: UserId;
};

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
    const payload = WebhookWorkflowPayloadSchema.parse(event.payload);
    try {
      await step.do("mark webhook running", async () => {
        await startWebhookEvent(this.env, webhookStateInput(payload, event.instanceId));
        return { ok: true };
      });
      const result = await step.do(
        "process verified webhook",
        {
          retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
          timeout: "5 minutes",
        },
        async () => processWebhookPayload(this.env, payload),
      );
      if (shouldStartUserDeletion(result)) {
        await step.do("enqueue user deletion lifecycle", async () => {
          return enqueueUserDeletionWorkflow(this.env, {
            requestedAt: payload.acceptedAt,
            userId: result.userId,
          });
        });
      }
      await step.do("mark webhook processed", async () => {
        await completeWebhookEvent(this.env, webhookStateInput(payload, event.instanceId));
        return { ok: true };
      });
      return result;
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

async function processWebhookPayload(
  env: WebhookWorkflowEnv,
  value: unknown,
): Promise<WebhookProcessResult> {
  const payload = WebhookWorkflowPayloadSchema.parse(value);
  const infrastructureResult = await processInfrastructureWebhook(env, payload);
  if (infrastructureResult) {
    return toWebhookProcessResult(payload.provider, infrastructureResult);
  }
  return processDatabaseWebhook(env, payload);
}

async function processDatabaseWebhook(
  env: WebhookWorkflowEnv,
  payload: WebhookWorkflowPayload,
): Promise<WebhookProcessResult> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const result = await processProviderWebhook(db, env, payload);
    const tier = resultTier(result);
    if (result.userId && (payload.provider === "clerk" || payload.provider === "polar")) {
      await refreshEntitlementCache(db, env.ENTITLEMENTS_CACHE, result.userId);
    }
    if (payload.provider === "clerk") {
      await syncPolarCustomerFromClerkUpdate(env, result);
    }
    // Analytics writes are a non-throwing tail. Emitting before a fallible provider
    // synchronization would duplicate events when the Workflow retries this step.
    if (result.userId && payload.provider === "clerk" && result.eventType === "user.created") {
      emitUserEvent(env, {
        authMethod: authMethodFromClerkEvent(payload.event),
        eventName: "signup_completed",
        userId: result.userId,
      });
    }
    emitPolarBillingEvents(env, payload.provider, result, tier);
    return toWebhookProcessResult(payload.provider, result, tier);
  } finally {
    await close();
  }
}

async function processInfrastructureWebhook(
  env: WebhookWorkflowEnv,
  payload: WebhookWorkflowPayload,
): Promise<BillingEventCandidate | null> {
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
        upsertUser: (input) => upsertClerkUser(db, input),
      },
      payload.event as WebhookEvent,
      new Date(payload.acceptedAt),
    );
  }
  if (payload.provider === "polar") {
    return handlePolarWebhookEvent(db, {
      accessToken: await polarAccessToken(env),
      event: payload.event,
      eventId: payload.eventId,
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
  result: BillingEventCandidate,
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
  result: BillingEventCandidate,
  tier: string | undefined,
): void {
  if (!result.userId || provider !== "polar") {
    return;
  }
  if (shouldEmitFirstPaid(result, tier)) {
    emitUserEvent(env, {
      eventName: "first_paid",
      plan: tier,
      userId: result.userId,
    });
  }
  if (shouldEmitTierUpgraded(result, tier)) {
    const fromPlan = previousTier(result);
    emitUserEvent(env, {
      eventName: "tier_upgraded",
      ...(fromPlan ? { fromPlan } : {}),
      toPlan: tier,
      userId: result.userId,
    });
  }
}

async function syncPolarCustomerFromClerkUpdate(
  env: WebhookWorkflowEnv,
  result: {
    displayName?: string | null;
    email?: string;
    eventType: string;
    polarCustomerId?: string | null;
    profileChanged?: boolean;
  },
): Promise<void> {
  if (
    result.eventType !== "user.updated" ||
    !result.profileChanged ||
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

function resultTier(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const tier = (result as Record<string, unknown>)["tier"];
  return typeof tier === "string" ? tier : undefined;
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

function shouldStartUserDeletion(
  result: WebhookProcessResult,
): result is WebhookProcessResult & { userId: UserId } {
  return result.provider === "clerk" && result.action === "deleted" && Boolean(result.userId);
}
