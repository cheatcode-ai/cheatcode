import {
  assertInternalMaintenanceEnvelope,
  verifyInternalMaintenanceRequest,
} from "@cheatcode/auth";
import { assertDatabaseRuntimeReadiness, createDb } from "@cheatcode/db";
import { APIError, readBoundedRequestText } from "@cheatcode/observability";
import {
  INTERNAL_DATABASE_READINESS_PATH,
  InternalDatabaseReadinessRequestSchema,
  WebhooksDatabaseReadinessResponseSchema,
} from "@cheatcode/types";
import type { Context, Hono } from "hono";
import type { WebhooksEnv } from "./index";
import {
  assertWebhooksServiceHostname,
  requireDatabaseReadinessSecret,
} from "./internal-maintenance";

const MAX_READINESS_BODY_BYTES = 4 * 1024;
type WebhooksContext = Context<{ Bindings: WebhooksEnv }>;

export function registerWebhooksDatabaseReadinessRoute(app: Hono<{ Bindings: WebhooksEnv }>): void {
  app.post(INTERNAL_DATABASE_READINESS_PATH, handleDatabaseReadiness);
}

async function handleDatabaseReadiness(c: WebhooksContext): Promise<Response> {
  if (c.env.CHEATCODE_RELEASE_GATE !== "closed") {
    throw releaseMismatch("Database readiness requires the closed release gate");
  }
  assertWebhooksServiceHostname(c.req.raw);
  assertInternalMaintenanceEnvelope(c.req.raw, {
    audience: "webhooks",
    capability: "database-readiness",
    issuer: "gateway",
  });
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_READINESS_BODY_BYTES,
    "Database readiness request",
  );
  await verifyInternalMaintenanceRequest({
    expectedAudience: "webhooks",
    expectedCapability: "database-readiness",
    expectedIssuer: "gateway",
    expectedMethod: "POST",
    expectedPathname: INTERNAL_DATABASE_READINESS_PATH,
    rawBody,
    request: c.req.raw,
    secret: await requireDatabaseReadinessSecret(c.env),
  });
  const request = InternalDatabaseReadinessRequestSchema.parse(parseJson(rawBody));
  if (c.env.CHEATCODE_RELEASE_SHA !== request.releaseSha) {
    throw releaseMismatch("Database readiness release does not match the webhooks Worker");
  }
  const { db, close } = createDb(c.env.HYPERDRIVE, {
    audience: "app_webhooks",
    signingSecret: c.env.DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS,
  });
  try {
    await assertDatabaseRuntimeReadiness(db, "app_webhooks");
  } catch (error) {
    throw new APIError(503, "unavailable_maintenance", "Webhooks database readiness failed", {
      cause: error,
      retriable: true,
    });
  } finally {
    await close();
  }
  return c.json(
    WebhooksDatabaseReadinessResponseSchema.parse({
      databaseRole: "app_webhooks",
      ok: true,
      releaseSha: request.releaseSha,
      versionId: c.env.CF_VERSION_METADATA?.id ?? null,
      worker: "webhooks",
    }),
  );
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new APIError(400, "invalid_request_body", "Database readiness body must be JSON", {
      retriable: false,
    });
  }
}

function releaseMismatch(message: string): APIError {
  return new APIError(409, "conflict_state_invalid", message, { retriable: false });
}
