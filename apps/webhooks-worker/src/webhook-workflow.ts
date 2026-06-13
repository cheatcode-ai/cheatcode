import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { tierRank, updateCustomerProfile } from "@cheatcode/billing";
import {
  createDb,
  type HyperdriveConnection,
  markClerkUserDeleted,
  upsertClerkUser,
} from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { type AnalyticsBindings, APIError, emitUserEvent } from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import type { WebhookEvent } from "@clerk/backend/webhooks";
import { z } from "zod";
import { handleClerkWebhookEvent } from "./clerk";
import { handleComposioWebhookEvent } from "./composio";
import { refreshEntitlementCache } from "./entitlement-cache";
import { enqueueUserDeletionWorkflow, type OpsWorkflowBindings } from "./ops-workflow";
import { handlePolarWebhookEvent } from "./polar";
import {
  completeWebhookEvent,
  type WebhookIdempotencyBindings,
  WebhookProviderSchema,
} from "./webhook-idempotency";

const WebhookWorkflowPayloadSchema = z.object({
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  event: z.unknown(),
  eventId: z.string().min(1).max(512),
  provider: WebhookProviderSchema,
  rawBody: z.string(),
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
          requestedAt: event.timestamp.getTime(),
          userId: result.userId,
        });
      });
    }
    await step.do("mark webhook processed", async () => {
      await completeWebhookEvent(this.env, {
        bodyHash: payload.bodyHash,
        eventId: payload.eventId,
        provider: payload.provider,
        workflowId: event.instanceId,
      });
      return { ok: true };
    });
    return result;
  }
}

export async function enqueueVerifiedWebhook(
  env: WebhookWorkflowBindings,
  payload: WebhookWorkflowPayload,
): Promise<string> {
  const parsed = WebhookWorkflowPayloadSchema.parse(payload);
  const instance = await env.WEBHOOK_WORKFLOW.create({
    id: webhookWorkflowId(parsed),
    params: parsed,
    retention: {
      errorRetention: "30 days",
      successRetention: "7 days",
    },
  });
  return instance.id;
}

export async function processWebhookPayload(
  env: WebhookWorkflowEnv,
  value: unknown,
): Promise<WebhookProcessResult> {
  const payload = WebhookWorkflowPayloadSchema.parse(value);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const result =
      payload.provider === "clerk"
        ? await handleClerkWebhookEvent(
            {
              markUserDeleted: (clerkId) => markClerkUserDeleted(db, clerkId),
              upsertUser: (input) => upsertClerkUser(db, input),
            },
            payload.event as WebhookEvent,
            payload.eventId,
          )
        : payload.provider === "polar"
          ? await handlePolarWebhookEvent(db, {
              event: payload.event,
              eventId: payload.eventId,
              rawBody: payload.rawBody,
            })
          : await handleComposioWebhookEvent(db, payload.event);

    const tier = resultTier(result);
    if (result.userId && (payload.provider === "clerk" || payload.provider === "polar")) {
      await refreshEntitlementCache(db, env.ENTITLEMENTS_CACHE, result.userId);
    }
    if (result.userId && payload.provider === "clerk" && result.eventType === "user.created") {
      emitUserEvent(env, {
        authMethod: authMethodFromClerkEvent(payload.event),
        eventName: "signup_completed",
        userId: result.userId,
      });
    }
    if (payload.provider === "clerk") {
      await syncPolarCustomerFromClerkUpdate(env, result);
    }
    emitPolarBillingEvents(env, payload.provider, result, tier);
    return {
      action: result.action,
      eventType: result.eventType,
      provider: payload.provider,
      ...(tier ? { tier } : {}),
      ...(result.userId ? { userId: result.userId } : {}),
    };
  } finally {
    await close();
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
  return result.action === "entitlement_synced" && tierRank(tier) > tierRank(from);
}

function webhookWorkflowId(payload: WebhookWorkflowPayload): string {
  return `webhook-${payload.provider}-${payload.bodyHash.slice(0, 32)}`;
}

function shouldStartUserDeletion(
  result: WebhookProcessResult,
): result is WebhookProcessResult & { userId: UserId } {
  return result.provider === "clerk" && result.action === "deleted" && Boolean(result.userId);
}
