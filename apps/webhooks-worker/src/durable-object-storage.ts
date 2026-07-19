import {
  assertInternalMaintenanceEnvelope,
  verifyInternalMaintenanceRequest,
} from "@cheatcode/auth";
import { APIError, readBoundedRequestText } from "@cheatcode/observability";
import {
  INTERNAL_DURABLE_OBJECT_STORAGE_PATH,
  InternalDurableObjectStorageRequestSchema,
  InternalDurableObjectStorageResponseSchema,
} from "@cheatcode/types";
import type { Context, Hono } from "hono";
import type { WebhooksEnv } from "./index";
import {
  assertWebhooksServiceHostname,
  requireDatabaseReadinessSecret,
} from "./internal-maintenance";

const MAX_STORAGE_BODY_BYTES = 4 * 1024;
type WebhooksContext = Context<{ Bindings: WebhooksEnv }>;

export function registerWebhooksDurableObjectStorageRoute(
  app: Hono<{ Bindings: WebhooksEnv }>,
): void {
  app.post(INTERNAL_DURABLE_OBJECT_STORAGE_PATH, handleDurableObjectStorage);
}

async function handleDurableObjectStorage(c: WebhooksContext): Promise<Response> {
  if (c.env.CHEATCODE_RELEASE_GATE !== "closed") {
    throw releaseMismatch("Durable Object reconciliation requires the closed release gate");
  }
  assertWebhooksServiceHostname(c.req.raw);
  assertInternalMaintenanceEnvelope(c.req.raw, {
    audience: "webhooks",
    capability: "durable-object-schema",
    issuer: "gateway",
  });
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_STORAGE_BODY_BYTES,
    "Durable Object storage request",
  );
  await verifyInternalMaintenanceRequest({
    expectedAudience: "webhooks",
    expectedCapability: "durable-object-schema",
    expectedIssuer: "gateway",
    expectedMethod: "POST",
    expectedPathname: INTERNAL_DURABLE_OBJECT_STORAGE_PATH,
    rawBody,
    request: c.req.raw,
    secret: await requireDatabaseReadinessSecret(c.env),
  });
  const input = InternalDurableObjectStorageRequestSchema.parse(parseJson(rawBody));
  if (
    input.releaseSha !== c.env.CHEATCODE_RELEASE_SHA ||
    input.className !== "WebhookIdempotencyStore"
  ) {
    throw releaseMismatch("Durable Object request does not match the webhooks release");
  }
  const id = c.env.WEBHOOK_IDEMPOTENCY.idFromString(input.objectId);
  return c.json(
    InternalDurableObjectStorageResponseSchema.parse(
      await c.env.WEBHOOK_IDEMPOTENCY.get(id).reconcileStorageSchema(input),
    ),
  );
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new APIError(400, "invalid_request_body", "Durable Object body must be JSON", {
      retriable: false,
    });
  }
}

function releaseMismatch(message: string): APIError {
  return new APIError(409, "conflict_state_invalid", message, { retriable: false });
}
