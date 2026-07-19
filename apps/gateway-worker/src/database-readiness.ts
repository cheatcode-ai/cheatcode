import {
  assertInternalMaintenanceEnvelope,
  createInternalMaintenanceHeaders,
  fetchClerkInstanceIdentity,
  verifyInternalMaintenanceRequest,
} from "@cheatcode/auth";
import { assertDatabaseRuntimeReadiness, createDb } from "@cheatcode/db";
import { resolveWorkerSecret } from "@cheatcode/env";
import {
  APIError,
  readBoundedRequestText,
  readBoundedResponseJson,
} from "@cheatcode/observability";
import {
  AgentDatabaseReadinessResponseSchema,
  ClerkInstanceIdentitySchema,
  GatewayDatabaseReadinessAggregateResponseSchema,
  INTERNAL_DATABASE_READINESS_PATH,
  InternalDatabaseReadinessRequestSchema,
  WebhooksDatabaseReadinessResponseSchema,
} from "@cheatcode/types";
import type { ZodType } from "zod";
import type { GatewayApp, GatewayContext, GatewayEnv } from "./gateway-env";
import { requireDatabaseReadinessSecret } from "./internal-maintenance";

const MAX_READINESS_BODY_BYTES = 4 * 1024;
const MAX_READINESS_RESPONSE_BYTES = 16 * 1024;

export function registerGatewayDatabaseReadinessRoute(app: GatewayApp): void {
  app.post(INTERNAL_DATABASE_READINESS_PATH, handleGatewayDatabaseReadiness);
}

async function handleGatewayDatabaseReadiness(c: GatewayContext): Promise<Response> {
  const { rawBody, releaseSha, secret } = await authenticateReadinessRequest(c);
  const [agent, webhooks, clerk] = await Promise.all([
    readDownstreamReadiness(c.env, "agent", rawBody, secret, AgentDatabaseReadinessResponseSchema),
    readDownstreamReadiness(
      c.env,
      "webhooks",
      rawBody,
      secret,
      WebhooksDatabaseReadinessResponseSchema,
    ),
    readClerkInstanceIdentity(c.env),
    assertGatewayDatabaseReady(c.env),
  ]);
  if (agent.releaseSha !== releaseSha || webhooks.releaseSha !== releaseSha) {
    throw releaseMismatch("A downstream database-readiness release does not match the gateway");
  }
  return c.json(
    GatewayDatabaseReadinessAggregateResponseSchema.parse({
      agent,
      clerk,
      databaseRole: "app_gateway",
      ok: true,
      releaseSha,
      versionId: c.env.CF_VERSION_METADATA?.id ?? null,
      webhooks,
      worker: "gateway",
    }),
  );
}

async function readClerkInstanceIdentity(env: GatewayEnv) {
  const secretKey = await resolveWorkerSecret(env.CLERK_SECRET_KEY);
  if (!secretKey?.trim()) {
    throw new APIError(503, "unavailable_maintenance", "Clerk identity readiness failed", {
      retriable: false,
    });
  }
  const identity = ClerkInstanceIdentitySchema.parse(
    await fetchClerkInstanceIdentity({ secretKey }),
  );
  if (env.CHEATCODE_ENVIRONMENT === "production" && identity.environmentType !== "production") {
    throw new APIError(503, "unavailable_maintenance", "Clerk identity readiness failed", {
      retriable: false,
    });
  }
  return identity;
}

async function authenticateReadinessRequest(c: GatewayContext): Promise<{
  rawBody: string;
  releaseSha: string;
  secret: string;
}> {
  assertClosedRelease(c.env);
  assertGatewayReadinessHostname(c.req.raw, c.env.CHEATCODE_ENVIRONMENT);
  assertInternalMaintenanceEnvelope(c.req.raw, {
    audience: "gateway",
    capability: "database-readiness",
    issuer: "release-control",
  });
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_READINESS_BODY_BYTES,
    "Database readiness request",
  );
  const secret = await requireDatabaseReadinessSecret(c.env);
  await verifyInternalMaintenanceRequest({
    expectedAudience: "gateway",
    expectedCapability: "database-readiness",
    expectedIssuer: "release-control",
    expectedMethod: "POST",
    expectedPathname: INTERNAL_DATABASE_READINESS_PATH,
    rawBody,
    request: c.req.raw,
    secret,
  });
  const { releaseSha } = InternalDatabaseReadinessRequestSchema.parse(parseJson(rawBody));
  assertReleaseSha(c.env, releaseSha);
  return { rawBody, releaseSha, secret };
}

async function assertGatewayDatabaseReady(env: GatewayEnv): Promise<void> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    await assertDatabaseRuntimeReadiness(db, "app_gateway");
  } catch (error) {
    throw new APIError(503, "unavailable_maintenance", "Gateway database readiness failed", {
      cause: error,
      retriable: true,
    });
  } finally {
    await close();
  }
}

async function readDownstreamReadiness<Result>(
  env: GatewayEnv,
  worker: "agent" | "webhooks",
  rawBody: string,
  secret: string,
  schema: ZodType<Result>,
): Promise<Result> {
  const headers = await createInternalMaintenanceHeaders({
    audience: worker,
    capability: "database-readiness",
    issuer: "gateway",
    method: "POST",
    pathname: INTERNAL_DATABASE_READINESS_PATH,
    rawBody,
    secret,
  });
  headers.set("content-type", "application/json");
  const binding = worker === "agent" ? env.AGENT : env.WEBHOOKS;
  let response: Response;
  try {
    response = await binding.fetch(
      `https://${worker}.internal${INTERNAL_DATABASE_READINESS_PATH}`,
      {
        body: rawBody,
        headers,
        method: "POST",
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch (error) {
    throw downstreamReadinessError(worker, error);
  }
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    throw downstreamReadinessError(worker, undefined, status);
  }
  try {
    return schema.parse(
      await readBoundedResponseJson(
        response,
        MAX_READINESS_RESPONSE_BYTES,
        `${worker} database readiness`,
      ),
    );
  } catch (error) {
    throw downstreamReadinessError(worker, error);
  }
}

function assertClosedRelease(env: GatewayEnv): void {
  if (env.CHEATCODE_RELEASE_GATE !== "closed") {
    throw releaseMismatch("Database readiness requires the closed release gate");
  }
}

function assertGatewayReadinessHostname(
  request: Request,
  environment: GatewayEnv["CHEATCODE_ENVIRONMENT"],
): void {
  const hostname = new URL(request.url).hostname;
  const isAllowed =
    environment === "production"
      ? hostname === "gateway.trycheatcode.com"
      : hostname === "127.0.0.1" || hostname === "localhost";
  if (!isAllowed) {
    throw new APIError(404, "not_found_run", "Database readiness route was not found", {
      retriable: false,
    });
  }
}

function assertReleaseSha(env: GatewayEnv, releaseSha: string): void {
  if (env.CHEATCODE_RELEASE_SHA !== releaseSha) {
    throw releaseMismatch("Database readiness release does not match the gateway");
  }
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

function downstreamReadinessError(
  worker: "agent" | "webhooks",
  cause?: unknown,
  status?: number,
): APIError {
  return new APIError(503, "unavailable_maintenance", `${worker} database readiness failed`, {
    cause,
    ...(status === undefined ? {} : { details: { status } }),
    retriable: true,
  });
}
