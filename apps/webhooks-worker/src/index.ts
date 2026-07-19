import {
  assertInternalMaintenanceEnvelope,
  verifyInternalMaintenanceRequest,
} from "@cheatcode/auth";
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
  emitErrorEvent,
  emitPerformanceMetric,
  readBoundedRequestText,
  safeErrorTelemetry,
  toAPIError,
  withErrorHandler,
} from "@cheatcode/observability";
import {
  INTERNAL_DATABASE_READINESS_PATH,
  INTERNAL_DURABLE_OBJECT_STORAGE_PATH,
  INTERNAL_RESOURCE_DELETION_PATH,
  InternalResourceDeletionRequestSchema,
} from "@cheatcode/types";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { Hono } from "hono";
import { z } from "zod";
import { verifyComposioWebhook } from "./composio";
import { registerWebhooksDatabaseReadinessRoute } from "./database-readiness";
import { DaytonaWebhookSchema, verifyDaytonaWebhook } from "./daytona";
import { registerWebhooksDurableObjectStorageRoute } from "./durable-object-storage";
import { internalAlertEventId, verifyInternalAlert } from "./internal-alert";
import {
  assertWebhookReplayHostname,
  assertWebhooksServiceHostname,
  requireResourceDeletionSecret,
  requireWebhookReplaySecret,
} from "./internal-maintenance";
import {
  enqueueAnalyticsWatchdog,
  enqueueByokRevalidation,
  OpsMaintenanceWorkflow,
  type OpsWorkflowBindings,
} from "./ops-workflow";
import { type ReleaseGateBindings, releaseGateError } from "./release-gate";
import {
  enqueueResourceDeletionWorkflow,
  ResourceDeletionWorkflow,
  type ResourceDeletionWorkflowBindings,
  reconcileResourceDeletionWorkflows,
} from "./resource-deletion-workflow";
import {
  enqueueDailyRetentionMetrics,
  reconcileDailyRetentionWorkflows,
} from "./retention-admission";
import { admitDueUserDeletionWorkflows } from "./user-deletion-admission";
import {
  acceptWebhookEvent,
  claimInternalWebhookReplay,
  completeWebhookEvent,
  getWebhookEventStatus,
  releaseInternalWebhookReplay,
  releaseWebhookEvent,
  type WebhookIdempotencyBindings,
  WebhookIdempotencyStore,
  WebhookProviderSchema,
} from "./webhook-idempotency";
import {
  enqueueVerifiedWebhook,
  WebhookWorkflow,
  type WebhookWorkflowBindings,
  type WebhookWorkflowPayload,
} from "./webhook-workflow";

export {
  OpsMaintenanceWorkflow,
  ResourceDeletionWorkflow,
  WebhookIdempotencyStore,
  WebhookWorkflow,
};

const MAX_PROVIDER_WEBHOOK_BODY_BYTES = 1024 * 1024;
const MAX_INTERNAL_WEBHOOK_BODY_BYTES = 64 * 1024;

export interface WebhooksEnv
  extends AnalyticsBindings,
    ReleaseGateBindings,
    WebhookIdempotencyBindings,
    OpsWorkflowBindings,
    ResourceDeletionWorkflowBindings,
    WebhookWorkflowBindings {
  AGENT: Fetcher;
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
  GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET: WorkerSecret;
  HYPERDRIVE: HyperdriveConnection;
  INTERNAL_ALERT_WEBHOOK_SECRET?: WorkerSecret;
  INTERNAL_ALERT_WEBHOOK_URL?: string;
  INTERNAL_WEBHOOK_REPLAY_SECRET: WorkerSecret;
  POLAR_ACCESS_TOKEN?: WorkerSecret;
  POLAR_PRODUCT_ID_MAX?: string;
  POLAR_PRODUCT_ID_PREMIUM?: string;
  POLAR_PRODUCT_ID_PRO?: string;
  POLAR_PRODUCT_ID_ULTRA?: string;
  POLAR_SERVER?: "production" | "sandbox";
  POLAR_WEBHOOK_SECRET?: WorkerSecret;
  QUOTA_TRACKER: DurableObjectNamespace;
  R2_OUTPUTS: R2Bucket;
  RELEASE_DATABASE_READINESS_SECRET: WorkerSecret;
  // Webhook-fed sandbox lifecycle cache (Daytona sandbox.state.updated), read by agent-worker's
  // preview-status endpoint. Optional so the endpoint falls back to a live read when unbound.
  SANDBOX_STATE?: KVNamespace;
  WEBHOOKS_TO_AGENT_LIFECYCLE_SECRET: WorkerSecret;
}

function requestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function withRequestId(response: Response, id: string): Response {
  const wrapped = new Response(response.body, response);
  wrapped.headers.set("X-Request-Id", id);
  return wrapped;
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

const WebhookReplaySchema = z
  .object({
    eventId: z.string().min(1).max(512),
    provider: WebhookProviderSchema,
  })
  .strict();

webhooksApp.onError((error, c) => {
  const id = c.req.header("X-Request-Id") ?? requestId();
  const apiError = toAPIError(error);
  emitErrorEvent(c.env, {
    errorCategory: "webhook",
    errorCode: apiError.code,
    httpStatus: apiError.status,
    route: routeName(c.req.raw),
    workerName: "webhooks",
    ...safeErrorTelemetry(error),
  });
  createLogger({ requestId: id }).error("webhook_request_failed", {
    apiCode: apiError.code,
    ...safeErrorTelemetry(error),
  });
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

webhooksApp.get("/health", (c) =>
  c.json({
    ok: true,
    releaseGate: c.env.CHEATCODE_RELEASE_GATE,
    releaseSha: c.env.CHEATCODE_RELEASE_SHA ?? "development",
    versionId: c.env.CF_VERSION_METADATA?.id ?? null,
    worker: "webhooks",
  }),
);

registerWebhooksDatabaseReadinessRoute(webhooksApp);
registerWebhooksDurableObjectStorageRoute(webhooksApp);
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

webhooksApp.post("/internal/webhooks/replay", async (c) => {
  assertWebhookReplayHostname(c.req.raw, c.env.CHEATCODE_ENVIRONMENT);
  assertInternalMaintenanceEnvelope(c.req.raw, {
    audience: "webhooks",
    capability: "webhook-replay",
    issuer: "operator",
  });
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_INTERNAL_WEBHOOK_BODY_BYTES,
    "Webhook replay",
  );
  await verifyInternalMaintenanceRequest({
    expectedAudience: "webhooks",
    expectedCapability: "webhook-replay",
    expectedIssuer: "operator",
    expectedMethod: "POST",
    expectedPathname: "/internal/webhooks/replay",
    rawBody,
    request: c.req.raw,
    secret: await requireWebhookReplaySecret(c.env),
  });
  const replay = WebhookReplaySchema.parse(parseJsonBody(rawBody, "Webhook replay"));
  const timestamp = c.req.header("x-cheatcode-maintenance-timestamp");
  if (!timestamp) {
    throw new APIError(401, "auth_token_invalid", "Missing internal maintenance timestamp", {
      retriable: false,
    });
  }
  const command = await claimInternalWebhookReplay(c.env, { rawBody, timestamp });
  if (!command.claimed) {
    return c.json({ duplicate: true, ok: true, replayed: false, status: "duplicate" });
  }
  try {
    return await replayWebhookEvent(c.env, replay);
  } catch (error) {
    await releaseInternalWebhookReplay(c.env, command.commandId);
    throw error;
  }
});

webhooksApp.post(INTERNAL_RESOURCE_DELETION_PATH, async (c) => {
  assertWebhooksServiceHostname(c.req.raw);
  assertInternalMaintenanceEnvelope(c.req.raw, {
    audience: "webhooks",
    capability: "resource-deletion",
    issuer: "gateway",
  });
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_INTERNAL_WEBHOOK_BODY_BYTES,
    "Resource deletion request",
  );
  await verifyInternalMaintenanceRequest({
    expectedAudience: "webhooks",
    expectedCapability: "resource-deletion",
    expectedIssuer: "gateway",
    expectedMethod: "POST",
    expectedPathname: INTERNAL_RESOURCE_DELETION_PATH,
    rawBody,
    request: c.req.raw,
    secret: await requireResourceDeletionSecret(c.env),
  });
  const payload = InternalResourceDeletionRequestSchema.parse(
    parseJsonBody(rawBody, "Resource deletion request"),
  );
  const jobId = await enqueueResourceDeletionWorkflow(c.env, payload);
  return c.json({ jobId, ok: true }, 202);
});

async function replayWebhookEvent(env: WebhooksEnv, replay: z.infer<typeof WebhookReplaySchema>) {
  const record = await getWebhookEventStatus(env, replay);
  if (!record) {
    throw new APIError(404, "not_found_run", "Webhook event state was not found", {
      retriable: false,
    });
  }
  if (!record.workflowId) {
    throw new APIError(409, "conflict_state_invalid", "Webhook event has no Workflow instance", {
      retriable: false,
    });
  }

  const instance = await env.WEBHOOK_WORKFLOW.get(record.workflowId);
  const workflowStatus = await instance.status();
  if (workflowStatus.status === "complete") {
    await completeWebhookEvent(env, {
      bodyHash: record.bodyHash,
      eventId: record.eventId,
      provider: record.provider,
      workflowId: record.workflowId,
    });
    return Response.json({ ok: true, replayed: false, status: "complete" });
  }
  if (workflowStatus.status === "errored" || workflowStatus.status === "terminated") {
    await instance.restart();
    return Response.json(
      { ok: true, replayed: true, status: workflowStatus.status },
      { status: 202 },
    );
  }
  if (workflowStatus.status === "paused") {
    await instance.resume();
    return Response.json({ ok: true, replayed: true, status: "paused" }, { status: 202 });
  }
  if (workflowStatus.status === "unknown") {
    throw new APIError(503, "unavailable_maintenance", "Webhook Workflow status is unknown", {
      retriable: true,
    });
  }
  return Response.json(
    { ok: true, replayed: false, status: workflowStatus.status },
    { status: 202 },
  );
}

webhooksApp.post("/internal/alert", async (c) => {
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_INTERNAL_WEBHOOK_BODY_BYTES,
    "Internal alert",
  );
  const secret = await internalAlertWebhookSecret(c.env);
  const alert = await verifyInternalAlert({
    rawBody,
    secret,
    signature: c.req.header("x-cheatcode-alert-signature") ?? null,
    timestamp: c.req.header("x-cheatcode-alert-timestamp") ?? null,
  });
  const result = await acceptAndEnqueueWebhook(c.env, {
    event: alert,
    eventId: await internalAlertEventId(rawBody),
    provider: "internal-alert",
    rawBody,
  });
  return c.json({ ok: true, alertId: alert.alertId, severity: alert.severity, ...result });
});

type VerifiedWebhookInput = Pick<WebhookWorkflowPayload, "event" | "eventId" | "provider"> & {
  rawBody: string;
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
  // An accepted row can outlive a Worker crash between the DO write and Workflow creation.
  // Re-enqueueing that state is safe because the Workflow id is deterministic.
  if (accepted.action === "duplicate" && accepted.state !== "accepted") {
    return { duplicate: true };
  }
  try {
    const workflow = await enqueueVerifiedWebhook(env, {
      acceptedAt: accepted.acceptedAt,
      bodyHash: accepted.bodyHash,
      event: input.event,
      eventId: input.eventId,
      provider: input.provider,
    });
    if (workflow.status === "complete") {
      await completeWebhookEvent(env, {
        bodyHash: accepted.bodyHash,
        eventId: input.eventId,
        provider: input.provider,
        workflowId: workflow.id,
      });
    }
    return { duplicate: accepted.action === "duplicate", workflowId: workflow.id };
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

function parseJsonBody(rawBody: string, label: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new APIError(400, "invalid_request_body", `${label} body must be valid JSON`, {
      retriable: false,
    });
  }
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
      const releaseGate = webhooksReleaseGateResponse(request, env, id);
      if (releaseGate) {
        return releaseGate;
      }
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
        ...safeErrorTelemetry(error),
      });
      logger.error("webhook_request_failed", {
        apiCode: apiError.code,
        ...safeErrorTelemetry(error),
      });
      return apiError.toResponse(id);
    }
  },
  async scheduled(
    controller: ScheduledController,
    env: WebhooksEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    WebhooksWorkerEnvSchema.parse(env);
    if (env.CHEATCODE_RELEASE_GATE !== "open") {
      return;
    }
    if (controller.cron === DAILY_RETENTION_METRICS_CRON) {
      ctx.waitUntil(enqueueDailyRetentionMetrics(env, controller.scheduledTime));
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
        reconcileDailyRetentionWorkflows(env).then((result) => {
          if (
            result.claimed > 0 ||
            result.created > 0 ||
            result.deferred > 0 ||
            result.purged > 0 ||
            result.restarted > 0 ||
            result.staleRelease > 0
          ) {
            createLogger().info("retention_workflows_reconciled", { ...result });
          }
        }),
      );
      return;
    }
  },
};

function webhooksReleaseGateResponse(
  request: Request,
  env: WebhooksEnv,
  id: string,
): Response | undefined {
  if (env.CHEATCODE_RELEASE_GATE === "open") {
    return undefined;
  }
  const url = new URL(request.url);
  if (
    env.CHEATCODE_RELEASE_GATE === "closed" &&
    request.method === "POST" &&
    (url.pathname === INTERNAL_DATABASE_READINESS_PATH ||
      url.pathname === INTERNAL_DURABLE_OBJECT_STORAGE_PATH)
  ) {
    return undefined;
  }
  if (request.method === "GET" && url.pathname === "/health") {
    return withRequestId(
      Response.json(
        {
          ok: true,
          releaseGate: env.CHEATCODE_RELEASE_GATE,
          releaseSha: env.CHEATCODE_RELEASE_SHA ?? "development",
          versionId: env.CF_VERSION_METADATA?.id ?? null,
          worker: "webhooks",
        },
        { headers: { "Cache-Control": "no-store" } },
      ),
      id,
    );
  }
  const response = releaseGateError(env.CHEATCODE_RELEASE_GATE).toResponse(id);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Retry-After", "5");
  return response;
}

const ANALYTICS_WATCHDOG_CRON = "*/5 * * * *";
const DAILY_RETENTION_METRICS_CRON = "20 0 * * *";

export default withErrorHandler(webhooksHandler, {
  errorCategory: "webhook",
  requestId: (request) => request.headers.get("X-Request-Id"),
  routeName,
  workerName: "webhooks",
});
