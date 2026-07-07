import type { HyperdriveConnection } from "@cheatcode/db";
import { resolveWorkerSecret, WebhooksWorkerEnvSchema, type WorkerSecret } from "@cheatcode/env";
import {
  type AnalyticsBindings,
  APIError,
  createLogger,
  emitErrorEvent,
  emitPerformanceMetric,
  toAPIError,
  withErrorHandler,
} from "@cheatcode/observability";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { Hono } from "hono";
import { runAutomationTick } from "./automation-runner";
import { verifyComposioWebhook } from "./composio";
import { cacheSandboxState, DaytonaWebhookSchema, verifyDaytonaWebhook } from "./daytona";
import { verifyInternalAlert } from "./internal-alert";
import {
  enqueueAnalyticsWatchdog,
  enqueueByokRevalidation,
  enqueueDailyUsageRollup,
  enqueueEgressCanary,
  OpsMaintenanceWorkflow,
  type OpsWorkflowBindings,
} from "./ops-workflow";
import {
  acceptWebhookEvent,
  releaseWebhookEvent,
  type WebhookIdempotencyBindings,
  WebhookIdempotencyStore,
  type WebhookProvider,
} from "./webhook-idempotency";
import {
  enqueueVerifiedWebhook,
  WebhookWorkflow,
  type WebhookWorkflowBindings,
  type WebhookWorkflowPayload,
} from "./webhook-workflow";

export { OpsMaintenanceWorkflow, WebhookIdempotencyStore, WebhookWorkflow };

export interface WebhooksEnv
  extends AnalyticsBindings,
    WebhookIdempotencyBindings,
    OpsWorkflowBindings,
    WebhookWorkflowBindings {
  AGENT?: Fetcher;
  CLERK_WEBHOOK_SECRET?: WorkerSecret;
  CLERK_WEBHOOK_SIGNING_SECRET?: WorkerSecret;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_API_TOKEN?: WorkerSecret;
  COMPOSIO_API_KEY?: WorkerSecret;
  COMPOSIO_WEBHOOK_SECRET?: WorkerSecret;
  DAYTONA_WEBHOOK_SIGNING_SECRET?: WorkerSecret;
  ENTITLEMENTS_CACHE: KVNamespace;
  GATEWAY?: Fetcher;
  HYPERDRIVE: HyperdriveConnection;
  INTERNAL_MAINTENANCE_SECRET?: WorkerSecret;
  INTERNAL_ALERT_WEBHOOK_SECRET?: WorkerSecret;
  INTERNAL_ALERT_WEBHOOK_URL?: string;
  POLAR_ACCESS_TOKEN?: WorkerSecret;
  POLAR_WEBHOOK_SECRET?: WorkerSecret;
  R2_OUTPUTS: R2Bucket;
  R2_SNAPSHOTS: R2Bucket;
  R2_UPLOADS: R2Bucket;
  // Webhook-fed sandbox lifecycle cache (Daytona sandbox.state.updated), read by agent-worker's
  // preview-status endpoint. Optional so the endpoint falls back to a live read when unbound.
  SANDBOX_STATE?: KVNamespace;
}

function requestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function withRequestId(response: Response, id: string): Response {
  const wrapped = new Response(response.body, response);
  wrapped.headers.set("X-Request-Id", id);
  return wrapped;
}

function errorEventDetails(error: unknown): { message?: string; stack?: string } {
  if (!(error instanceof Error)) {
    return {};
  }
  return {
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
  };
}

async function clerkWebhookSigningSecret(env: WebhooksEnv): Promise<string> {
  const secret = await readOptionalSecret(
    env.CLERK_WEBHOOK_SIGNING_SECRET ?? env.CLERK_WEBHOOK_SECRET,
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

async function internalAlertWebhookSecret(env: WebhooksEnv): Promise<string> {
  const secret = await readOptionalSecret(
    env.INTERNAL_ALERT_WEBHOOK_SECRET,
    "INTERNAL_ALERT_WEBHOOK_SECRET",
  );
  if (!secret) {
    throw new APIError(
      503,
      "unavailable_maintenance",
      "Internal alert verification is not configured",
      {
        hint: "Set INTERNAL_ALERT_WEBHOOK_SECRET on the webhooks Worker.",
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

webhooksApp.onError((error, c) => {
  const id = c.req.header("X-Request-Id") ?? requestId();
  const apiError = toAPIError(error);
  emitErrorEvent(c.env, {
    errorCategory: "webhook",
    errorCode: apiError.code,
    httpStatus: apiError.status,
    route: routeName(c.req.raw),
    workerName: "webhooks",
    ...errorEventDetails(error),
  });
  createLogger({ requestId: id }).error("webhook_request_failed", { code: apiError.code });
  return apiError.toResponse(id);
});

webhooksApp.use("*", async (c, next) => {
  const startedAt = performance.now();
  let status = 500;
  try {
    await next();
    status = c.res.status;
  } finally {
    emitPerformanceMetric(c.env, {
      route: routeName(c.req.raw),
      statusClass: statusClass(status),
      totalMs: performance.now() - startedAt,
      workerName: "webhooks",
    });
  }
});

webhooksApp.get("/health", (c) => c.json({ ok: true, worker: "webhooks" }));

webhooksApp.post("/clerk", async (c) => {
  const signingSecret = await clerkWebhookSigningSecret(c.env);
  const rawBody = await c.req.raw.clone().text();
  const event = await verifyWebhook(c.req.raw, { signingSecret }).catch(() => {
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
  const rawBody = await c.req.raw.text();
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
  const rawBody = await c.req.raw.text();
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

// Daytona sandbox lifecycle events → refresh the sandbox-state cache so the preview panel can
// show boot/paused state without polling Daytona. Lightweight + idempotent (no workflow queue).
webhooksApp.post("/daytona", async (c) => {
  const rawBody = await c.req.raw.text();
  const secret = await readOptionalSecret(
    c.env.DAYTONA_WEBHOOK_SIGNING_SECRET,
    "DAYTONA_WEBHOOK_SIGNING_SECRET",
  );
  const verified = await verifyDaytonaWebhook(
    secret ?? null,
    rawBody,
    c.req.header("x-signature") ?? null,
  );
  if (!verified) {
    return c.json({ error: "invalid_signature" }, 401);
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }
  const parsed = DaytonaWebhookSchema.safeParse(payload);
  if (parsed.success) {
    await cacheSandboxState(c.env.SANDBOX_STATE, parsed.data, new Date().toISOString());
  }
  return c.json({ ok: true });
});

webhooksApp.post("/internal/alert", async (c) => {
  const rawBody = await c.req.raw.text();
  const secret = await internalAlertWebhookSecret(c.env);
  const alert = await verifyInternalAlert({
    rawBody,
    secret,
    signature: c.req.header("x-cheatcode-alert-signature") ?? null,
    timestamp: c.req.header("x-cheatcode-alert-timestamp") ?? null,
  });
  const alertRequestId = c.req.header("X-Request-Id");

  createLogger(alertRequestId ? { requestId: alertRequestId } : {}).warn(
    "internal_alert_received",
    {
      alertId: alert.alertId,
      description: alert.description,
      metric: alert.metric,
      route: alert.route,
      runId: alert.runId,
      service: alert.service,
      severity: alert.severity,
      source: alert.source,
      title: alert.title,
      userId: alert.userId,
      workerName: alert.workerName,
    },
  );
  emitErrorEvent(c.env, {
    errorCategory: "ops_alert",
    errorCode: alert.source,
    message: `${alert.severity}: ${alert.title}`,
    workerName: alert.workerName ?? "webhooks",
    ...(alert.route ? { route: alert.route } : {}),
    ...(alert.runId ? { runId: alert.runId } : {}),
    ...(alert.userId ? { userId: alert.userId } : {}),
  });

  return c.json({ ok: true, alertId: alert.alertId, severity: alert.severity });
});

type VerifiedWebhookInput = Omit<WebhookWorkflowPayload, "bodyHash"> & {
  provider: WebhookProvider;
};

interface EnqueuedWebhookResponse {
  duplicate: boolean;
  workflowId?: string;
}

async function acceptAndEnqueueWebhook(
  env: WebhooksEnv,
  input: VerifiedWebhookInput,
): Promise<EnqueuedWebhookResponse> {
  const accepted = await acceptWebhookEvent(env, input);
  if (accepted.action === "duplicate") {
    return { duplicate: true };
  }
  try {
    const workflowId = await enqueueVerifiedWebhook(env, {
      ...input,
      bodyHash: accepted.bodyHash,
    });
    return { duplicate: false, workflowId };
  } catch (error) {
    await releaseWebhookEvent(env, {
      bodyHash: accepted.bodyHash,
      eventId: input.eventId,
      provider: input.provider,
    });
    throw error;
  }
}

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

function routeName(request: Request): string {
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}`;
}

function statusClass(status: number): string {
  if (status >= 500) {
    return "5xx";
  }
  if (status >= 400) {
    return "4xx";
  }
  if (status >= 300) {
    return "3xx";
  }
  return "2xx";
}

function headersToRecord(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

const webhooksHandler = {
  async fetch(request: Request, env: WebhooksEnv, ctx: ExecutionContext): Promise<Response> {
    WebhooksWorkerEnvSchema.parse(env);
    const id = requestId();
    const logger = createLogger({ requestId: id });
    try {
      const requestWithId = new Request(request);
      requestWithId.headers.set("X-Request-Id", id);
      const response = await webhooksApp.fetch(requestWithId, env, ctx);
      return withRequestId(response, id);
    } catch (error) {
      const apiError = toAPIError(error);
      emitErrorEvent(env, {
        errorCategory: "webhook",
        errorCode: apiError.code,
        httpStatus: apiError.status,
        route: routeName(request),
        workerName: "webhooks",
        ...errorEventDetails(error),
      });
      logger.error("webhook_request_failed", { code: apiError.code });
      return apiError.toResponse(id);
    }
  },
  async scheduled(
    controller: ScheduledController,
    env: WebhooksEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    WebhooksWorkerEnvSchema.parse(env);
    if (controller.cron === DAILY_USAGE_ROLLUP_CRON) {
      ctx.waitUntil(enqueueDailyUsageRollup(env, controller.scheduledTime));
      return;
    }
    if (controller.cron === BYOK_REVALIDATION_CRON) {
      ctx.waitUntil(enqueueByokRevalidation(env, controller.scheduledTime));
      return;
    }
    if (controller.cron === ANALYTICS_WATCHDOG_CRON) {
      ctx.waitUntil(enqueueAnalyticsWatchdog(env, controller.scheduledTime));
      // Automations ride the 5-minute tick (CF cron-trigger limit blocks a dedicated
      // 1-minute schedule); scheduled automations fire within ~5 min of their time.
      ctx.waitUntil(runAutomationTick(env, controller.scheduledTime));
      return;
    }
    if (controller.cron === EGRESS_CANARY_CRON) {
      ctx.waitUntil(enqueueEgressCanary(env, controller.scheduledTime));
    }
  },
};

const ANALYTICS_WATCHDOG_CRON = "*/5 * * * *";
const BYOK_REVALIDATION_CRON = "35 0 * * *";
const DAILY_USAGE_ROLLUP_CRON = "20 0 * * *";
const EGRESS_CANARY_CRON = "30 3 * * *";

export default withErrorHandler(webhooksHandler, {
  errorCategory: "webhook",
  requestId: (request) => request.headers.get("X-Request-Id"),
  routeName,
  workerName: "webhooks",
});
