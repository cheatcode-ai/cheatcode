import type { HyperdriveConnection } from "@cheatcode/db";
import {
  type CloudflareVersionMetadata,
  resolveWorkerSecret,
  WebhooksWorkerEnvSchema,
  type WorkerSecret,
} from "@cheatcode/env";
import {
  type AnalyticsBindings,
  APIError,
  createLogger,
  createPerformanceMetricMiddleware,
  createWorkerRuntime,
  readBoundedRequestText,
  routeName,
} from "@cheatcode/observability";
import type { AgentLifecycleServiceBinding } from "@cheatcode/types";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { type Context, Hono } from "hono";
import { verifyComposioWebhook } from "./composio";
import {
  enqueueDailyMaintenance,
  reconcileDailyMaintenanceWorkflows,
} from "./daily-maintenance-admission";
import { DaytonaWebhookSchema, verifyDaytonaWebhook } from "./daytona";
import {
  enqueueAnalyticsWatchdog,
  enqueueByokRevalidation,
  OpsMaintenanceWorkflow,
  type OpsWorkflowBindings,
} from "./ops-workflow";
import type { QuotaTrackerNamespace } from "./quota-tracker-binding";
import { ResourceDeletionEntrypoint } from "./resource-deletion-entrypoint";
import {
  ResourceDeletionWorkflow,
  type ResourceDeletionWorkflowBindings,
  reconcileResourceDeletionWorkflows,
} from "./resource-deletion-workflow";
import { admitDueUserDeletionWorkflows } from "./user-deletion-admission";
import { type WebhookIdempotencyBindings, WebhookIdempotencyStore } from "./webhook-idempotency";
import { acceptAndEnqueueWebhook } from "./webhook-ingress";
import { WebhookWorkflow, type WebhookWorkflowBindings } from "./webhook-workflow";

export {
  OpsMaintenanceWorkflow,
  ResourceDeletionEntrypoint,
  ResourceDeletionWorkflow,
  WebhookIdempotencyStore,
  WebhookWorkflow,
};

const MAX_PROVIDER_WEBHOOK_BODY_BYTES = 1024 * 1024;
const MAX_INTERNAL_WEBHOOK_BODY_BYTES = 64 * 1024;

export interface WebhooksEnv
  extends AnalyticsBindings,
    WebhookIdempotencyBindings,
    OpsWorkflowBindings,
    ResourceDeletionWorkflowBindings,
    WebhookWorkflowBindings {
  AGENT_LIFECYCLE: AgentLifecycleServiceBinding;
  CF_VERSION_METADATA?: CloudflareVersionMetadata;
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CHEATCODE_RELEASE_SHA?: string;
  CLERK_WEBHOOK_SIGNING_SECRET?: WorkerSecret;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_API_TOKEN?: WorkerSecret;
  COMPOSIO_API_KEY?: WorkerSecret;
  COMPOSIO_WEBHOOK_SECRET?: WorkerSecret;
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
  DAYTONA_WEBHOOK_SIGNING_SECRET: WorkerSecret;
  ENTITLEMENTS_CACHE: KVNamespace;
  HYPERDRIVE: HyperdriveConnection;
  POLAR_ACCESS_TOKEN?: WorkerSecret;
  POLAR_PRODUCT_ID_MAX?: string;
  POLAR_PRODUCT_ID_PREMIUM?: string;
  POLAR_PRODUCT_ID_PRO?: string;
  POLAR_PRODUCT_ID_ULTRA?: string;
  POLAR_SERVER?: "production" | "sandbox";
  POLAR_WEBHOOK_SECRET?: WorkerSecret;
  QUOTA_TRACKER: QuotaTrackerNamespace;
  R2_OUTPUTS: R2Bucket;
  // Webhook-fed sandbox lifecycle cache (Daytona sandbox.state.updated), read by agent-worker's
  // preview-status endpoint. Optional so the endpoint falls back to a live read when unbound.
  SANDBOX_STATE?: KVNamespace;
}

async function clerkWebhookSigningSecret(env: WebhooksEnv): Promise<string> {
  const secret = await readOptionalSecret(
    env.CLERK_WEBHOOK_SIGNING_SECRET,
    "CLERK_WEBHOOK_SIGNING_SECRET",
  );
  if (!secret) {
    throw new APIError(
      503,
      "unavailable_maintenance",
      "Clerk webhook verification is not configured",
      {
        hint: "Set CLERK_WEBHOOK_SIGNING_SECRET on the webhooks Worker.",
        retriable: false,
      },
    );
  }
  return secret;
}

async function polarWebhookSecret(env: WebhooksEnv): Promise<string> {
  const secret = await readOptionalSecret(env.POLAR_WEBHOOK_SECRET, "POLAR_WEBHOOK_SECRET");
  if (!secret) {
    throw new APIError(
      503,
      "unavailable_maintenance",
      "Polar webhook verification is not configured",
      {
        hint: "Set POLAR_WEBHOOK_SECRET on the webhooks Worker.",
        retriable: false,
      },
    );
  }
  return secret;
}

async function composioWebhookSecret(env: WebhooksEnv): Promise<string> {
  const secret = await readOptionalSecret(env.COMPOSIO_WEBHOOK_SECRET, "COMPOSIO_WEBHOOK_SECRET");
  if (!secret) {
    throw new APIError(
      503,
      "unavailable_maintenance",
      "Composio webhook verification is not configured",
      {
        hint: "Set COMPOSIO_WEBHOOK_SECRET on the webhooks Worker.",
        retriable: false,
      },
    );
  }
  return secret;
}

async function readOptionalSecret(
  secret: WorkerSecret | undefined,
  name: string,
): Promise<string | undefined> {
  try {
    return await resolveWorkerSecret(secret);
  } catch {
    throw new APIError(503, "unavailable_maintenance", `${name} is unavailable`, {
      hint: `Verify the ${name} Cloudflare Secrets Store binding and secret value.`,
      retriable: false,
    });
  }
}

export const webhooksApp = new Hono<{ Bindings: WebhooksEnv }>();

webhooksApp.onError((error) => {
  throw error;
});

webhooksApp.use(
  "*",
  createPerformanceMetricMiddleware<WebhooksEnv, Context<{ Bindings: WebhooksEnv }>>({
    routeName: (context) => routeName(context.req.raw),
    workerName: "webhooks",
  }),
);

webhooksApp.get("/health", (c) =>
  c.json({
    ok: true,
    releaseSha: c.env.CHEATCODE_RELEASE_SHA ?? "development",
    versionId: c.env.CF_VERSION_METADATA?.id ?? null,
    worker: "webhooks",
  }),
);

webhooksApp.post("/clerk", async (c) => {
  const signingSecret = await clerkWebhookSigningSecret(c.env);
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_PROVIDER_WEBHOOK_BODY_BYTES,
    "Clerk webhook",
  );
  const verificationRequest = new Request(c.req.raw.url, {
    body: rawBody,
    headers: c.req.raw.headers,
    method: c.req.raw.method,
  });
  const event = await verifyWebhook(verificationRequest, { signingSecret }).catch(() => {
    throw new APIError(401, "auth_token_invalid", "Invalid Clerk webhook signature", {
      retriable: false,
    });
  });
  const result = await acceptAndEnqueueWebhook(c.env, {
    event,
    eventId: requiredHeader(c.req.raw.headers, "svix-id", "Clerk"),
    provider: "clerk",
    rawBody,
  });
  return c.json({ ok: true, ...result });
});

webhooksApp.post("/polar", async (c) => {
  const signingSecret = await polarWebhookSecret(c.env);
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_PROVIDER_WEBHOOK_BODY_BYTES,
    "Polar webhook",
  );
  let event: ReturnType<typeof validateEvent>;
  try {
    event = validateEvent(rawBody, headersToRecord(c.req.raw.headers), signingSecret);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      throw new APIError(401, "auth_token_invalid", "Invalid Polar webhook signature", {
        retriable: false,
      });
    }
    throw error;
  }

  const result = await acceptAndEnqueueWebhook(c.env, {
    event,
    eventId: requiredHeader(c.req.raw.headers, "webhook-id", "Polar"),
    provider: "polar",
    rawBody,
  });
  return c.json({ ok: true, ...result });
});

webhooksApp.post("/composio", async (c) => {
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_PROVIDER_WEBHOOK_BODY_BYTES,
    "Composio webhook",
  );
  const secret = await composioWebhookSecret(c.env);
  const eventId = requiredHeader(c.req.raw.headers, "webhook-id", "Composio");
  const event = await verifyComposioWebhook({
    rawBody,
    secret,
    webhookId: eventId,
    webhookSignature: c.req.header("webhook-signature") ?? null,
    webhookTimestamp: c.req.header("webhook-timestamp") ?? null,
  });
  const result = await acceptAndEnqueueWebhook(c.env, {
    event,
    eventId,
    provider: "composio",
    rawBody,
  });
  return c.json({ ok: true, ...result });
});

// Daytona sandbox lifecycle events flow through the same durable idempotency + Workflow path as
// the external providers. The Workflow serializes cache updates by sandbox/event time.
webhooksApp.post("/daytona", async (c) => {
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_INTERNAL_WEBHOOK_BODY_BYTES,
    "Daytona webhook",
  );
  const secret = await readOptionalSecret(
    c.env.DAYTONA_WEBHOOK_SIGNING_SECRET,
    "DAYTONA_WEBHOOK_SIGNING_SECRET",
  );
  if (!secret) {
    throw new APIError(
      503,
      "unavailable_maintenance",
      "Daytona webhook verification is not configured",
      { retriable: false },
    );
  }
  const envelope = await verifyDaytonaWebhook(secret, rawBody, c.req.raw.headers);
  if (!envelope) {
    return c.json({ error: "invalid_signature" }, 401);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new APIError(400, "invalid_request_body", "Daytona webhook JSON is invalid", {
      retriable: false,
    });
  }
  const parsed = DaytonaWebhookSchema.parse(payload);
  const result = await acceptAndEnqueueWebhook(c.env, {
    event: parsed,
    eventId: envelope.eventId,
    provider: "daytona",
    rawBody,
  });
  return c.json({ ok: true, ...result });
});

function requiredHeader(headers: Headers, name: string, provider: string): string {
  const value = headers.get(name)?.trim();
  if (!value) {
    throw new APIError(400, "invalid_request_body", `Missing ${provider} webhook event id`, {
      hint: `Expected the ${name} header before accepting this webhook event.`,
      retriable: false,
    });
  }
  return value;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

const webhooksRuntime = createWorkerRuntime<WebhooksEnv, ExecutionContext>({
  errorCategory: "webhook",
  errorLogName: "webhook_request_failed",
  fetch: (request, env, ctx) => {
    WebhooksWorkerEnvSchema.parse(env);
    return webhooksApp.fetch(request, env, ctx);
  },
  routeName,
  workerName: "webhooks",
});

const webhooksHandler = {
  ...webhooksRuntime,
  async scheduled(
    controller: ScheduledController,
    env: WebhooksEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    WebhooksWorkerEnvSchema.parse(env);
    if (controller.cron === DAILY_MAINTENANCE_CRON) {
      ctx.waitUntil(enqueueDailyMaintenance(env, controller.scheduledTime));
      return;
    }
    if (controller.cron === ANALYTICS_WATCHDOG_CRON) {
      ctx.waitUntil(enqueueAnalyticsWatchdog(env, controller.scheduledTime));
      ctx.waitUntil(enqueueByokRevalidation(env, controller.scheduledTime));
      ctx.waitUntil(
        admitDueUserDeletionWorkflows(env, controller.scheduledTime).then((result) => {
          if (
            result.claimed > 0 ||
            result.deferred > 0 ||
            result.discovered > 0 ||
            result.quarantined > 0 ||
            result.stale > 0
          ) {
            createLogger().info("user_deletion_workflows_admitted", { ...result });
          }
        }),
      );
      ctx.waitUntil(
        reconcileResourceDeletionWorkflows(env).then((result) => {
          if (
            result.claimed > 0 ||
            result.projects > 0 ||
            result.quarantined > 0 ||
            result.threads > 0
          ) {
            createLogger().info("resource_deletion_reconciliation_enqueued", result);
          }
        }),
      );
      ctx.waitUntil(
        reconcileDailyMaintenanceWorkflows(env).then((result) => {
          if (
            result.claimed > 0 ||
            result.created > 0 ||
            result.deferred > 0 ||
            result.purged > 0 ||
            result.restarted > 0 ||
            result.staleRelease > 0
          ) {
            createLogger().info("daily_maintenance_workflows_reconciled", { ...result });
          }
        }),
      );
      return;
    }
  },
};

const ANALYTICS_WATCHDOG_CRON = "*/5 * * * *";
const DAILY_MAINTENANCE_CRON = "20 0 * * *";

export default webhooksHandler;
