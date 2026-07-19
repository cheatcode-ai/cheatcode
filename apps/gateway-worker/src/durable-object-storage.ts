import {
  assertInternalMaintenanceEnvelope,
  createInternalMaintenanceHeaders,
  verifyInternalMaintenanceRequest,
} from "@cheatcode/auth";
import {
  APIError,
  readBoundedRequestText,
  readBoundedResponseJson,
} from "@cheatcode/observability";
import {
  INTERNAL_DURABLE_OBJECT_STORAGE_PATH,
  type InternalDurableObjectStorageRequest,
  InternalDurableObjectStorageRequestSchema,
  type InternalDurableObjectStorageResponse,
  InternalDurableObjectStorageResponseSchema,
} from "@cheatcode/types";
import type { GatewayApp, GatewayContext, GatewayEnv } from "./gateway-env";
import { requireDatabaseReadinessSecret } from "./internal-maintenance";

const MAX_STORAGE_BODY_BYTES = 4 * 1024;
const MAX_STORAGE_RESPONSE_BYTES = 16 * 1024;
const DOWNSTREAM_STORAGE_ATTESTATION_TIMEOUT_MS = 2 * 60 * 1_000;

export function registerGatewayDurableObjectStorageRoute(app: GatewayApp): void {
  app.post(INTERNAL_DURABLE_OBJECT_STORAGE_PATH, handleDurableObjectStorage);
}

async function handleDurableObjectStorage(c: GatewayContext): Promise<Response> {
  const { input, rawBody, secret } = await authenticateRequest(c);
  const result = await routeStorageRequest(c.env, input, rawBody, secret);
  return c.json(assertMatchingEvidence(input, result));
}

async function authenticateRequest(c: GatewayContext): Promise<{
  input: InternalDurableObjectStorageRequest;
  rawBody: string;
  secret: string;
}> {
  assertClosedRelease(c.env, c.req.raw);
  assertInternalMaintenanceEnvelope(c.req.raw, {
    audience: "gateway",
    capability: "durable-object-schema",
    issuer: "release-control",
  });
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_STORAGE_BODY_BYTES,
    "Durable Object storage request",
  );
  const secret = await requireDatabaseReadinessSecret(c.env);
  await verifyInternalMaintenanceRequest({
    expectedAudience: "gateway",
    expectedCapability: "durable-object-schema",
    expectedIssuer: "release-control",
    expectedMethod: "POST",
    expectedPathname: INTERNAL_DURABLE_OBJECT_STORAGE_PATH,
    rawBody,
    request: c.req.raw,
    secret,
  });
  const input = InternalDurableObjectStorageRequestSchema.parse(parseJson(rawBody));
  if (input.releaseSha !== c.env.CHEATCODE_RELEASE_SHA) {
    throw mismatch("Durable Object request does not match the closed gateway release");
  }
  return { input, rawBody, secret };
}

function assertClosedRelease(env: GatewayEnv, request: Request): void {
  if (env.CHEATCODE_RELEASE_GATE !== "closed") {
    throw mismatch("Durable Object reconciliation requires the closed release gate");
  }
  const hostname = new URL(request.url).hostname;
  const validHost =
    env.CHEATCODE_ENVIRONMENT === "production"
      ? hostname === "gateway.trycheatcode.com"
      : hostname === "127.0.0.1" || hostname === "localhost";
  if (!validHost) {
    throw new APIError(404, "not_found_run", "Durable Object route was not found", {
      retriable: false,
    });
  }
}

async function routeStorageRequest(
  env: GatewayEnv,
  input: InternalDurableObjectStorageRequest,
  rawBody: string,
  secret: string,
): Promise<InternalDurableObjectStorageResponse> {
  if (input.className === "AgentRun" || input.className === "ProjectSandbox") {
    return readDownstreamStorage(env.AGENT, "agent", input, rawBody, secret);
  }
  if (input.className === "WebhookIdempotencyStore") {
    return readDownstreamStorage(env.WEBHOOKS, "webhooks", input, rawBody, secret);
  }
  if (input.className === "IdempotencyStore") {
    const id = env.IDEMPOTENCY.idFromString(input.objectId);
    return env.IDEMPOTENCY.get(id).reconcileStorageSchema(input);
  }
  if (input.className === "QuotaTracker") {
    const id = env.QUOTA_TRACKER.idFromString(input.objectId);
    return env.QUOTA_TRACKER.get(id).reconcileStorageSchema(input);
  }
  const id = env.RATE_LIMITER.idFromString(input.objectId);
  return env.RATE_LIMITER.get(id).reconcileStorageSchema(input);
}

async function readDownstreamStorage(
  binding: Fetcher,
  worker: "agent" | "webhooks",
  input: InternalDurableObjectStorageRequest,
  rawBody: string,
  secret: string,
): Promise<InternalDurableObjectStorageResponse> {
  const headers = await createInternalMaintenanceHeaders({
    audience: worker,
    capability: "durable-object-schema",
    issuer: "gateway",
    method: "POST",
    pathname: INTERNAL_DURABLE_OBJECT_STORAGE_PATH,
    rawBody,
    secret,
  });
  headers.set("content-type", "application/json");
  const response = await binding.fetch(
    `https://${worker}.internal${INTERNAL_DURABLE_OBJECT_STORAGE_PATH}`,
    {
      body: rawBody,
      headers,
      method: "POST",
      signal: AbortSignal.timeout(DOWNSTREAM_STORAGE_ATTESTATION_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new APIError(503, "unavailable_maintenance", `${worker} storage attestation failed`, {
      details: { status: response.status },
      retriable: true,
    });
  }
  return assertMatchingEvidence(
    input,
    InternalDurableObjectStorageResponseSchema.parse(
      await readBoundedResponseJson(
        response,
        MAX_STORAGE_RESPONSE_BYTES,
        `${worker} Durable Object storage attestation`,
      ),
    ),
  );
}

function assertMatchingEvidence(
  input: InternalDurableObjectStorageRequest,
  evidence: InternalDurableObjectStorageResponse,
): InternalDurableObjectStorageResponse {
  const parsed = InternalDurableObjectStorageResponseSchema.parse(evidence);
  if (
    parsed.className !== input.className ||
    parsed.objectId !== input.objectId ||
    parsed.releaseSha !== input.releaseSha
  ) {
    throw mismatch("Durable Object storage evidence does not match the request");
  }
  return parsed;
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

function mismatch(message: string): APIError {
  return new APIError(409, "conflict_state_invalid", message, { retriable: false });
}
