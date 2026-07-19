import { assertDatabaseRuntimeReadiness, createDb } from "@cheatcode/db";
import { resolveWorkerSecret } from "@cheatcode/env";
import { APIError, readBoundedRequestText } from "@cheatcode/observability";
import { DaytonaClient } from "@cheatcode/tools-code";
import {
  AgentDatabaseReadinessResponseSchema,
  DaytonaVolumeIdentitySchema,
  INTERNAL_DATABASE_READINESS_PATH,
  InternalDatabaseReadinessRequestSchema,
} from "@cheatcode/types";
import type { Context, Hono } from "hono";
import type { AgentEnv } from "./agent-env";
import {
  assertAgentDatabaseReadinessCapability,
  assertAgentInternalHostname,
  parseInternalMaintenanceJson,
  verifyAgentDatabaseReadinessRequest,
} from "./internal-maintenance";

const MAX_READINESS_BODY_BYTES = 4 * 1024;
type AgentContext = Context<{ Bindings: AgentEnv }>;

export function registerAgentDatabaseReadinessRoute(app: Hono<{ Bindings: AgentEnv }>): void {
  app.post(INTERNAL_DATABASE_READINESS_PATH, handleDatabaseReadiness);
}

async function handleDatabaseReadiness(c: AgentContext): Promise<Response> {
  if (c.env.CHEATCODE_RELEASE_GATE !== "closed") {
    throw releaseMismatch("Database readiness requires the closed release gate");
  }
  assertAgentInternalHostname(c.req.raw);
  assertAgentDatabaseReadinessCapability(c.req.raw);
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_READINESS_BODY_BYTES,
    "Database readiness request",
  );
  await verifyAgentDatabaseReadinessRequest({
    expectedPathname: INTERNAL_DATABASE_READINESS_PATH,
    rawBody,
    request: c.req.raw,
    secrets: c.env,
  });
  const request = InternalDatabaseReadinessRequestSchema.parse(
    parseInternalMaintenanceJson(rawBody),
  );
  if (c.env.CHEATCODE_RELEASE_SHA !== request.releaseSha) {
    throw releaseMismatch("Database readiness release does not match the agent Worker");
  }
  const [, daytona] = await Promise.all([
    assertAgentDatabaseReady(c.env),
    readDaytonaVolumeIdentity(c.env),
  ]);
  return c.json(
    AgentDatabaseReadinessResponseSchema.parse({
      databaseRole: "app_agent",
      daytona,
      ok: true,
      releaseSha: request.releaseSha,
      versionId: c.env.CF_VERSION_METADATA?.id ?? null,
      worker: "agent",
    }),
  );
}

async function assertAgentDatabaseReady(env: AgentEnv): Promise<void> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    await assertDatabaseRuntimeReadiness(db, "app_agent");
  } catch (error) {
    throw new APIError(503, "unavailable_maintenance", "Agent database readiness failed", {
      cause: error,
      retriable: true,
    });
  } finally {
    await close();
  }
}

async function readDaytonaVolumeIdentity(env: AgentEnv) {
  try {
    const organizationId = requiredDaytonaOrganizationId(env);
    const apiKey = await resolveWorkerSecret(env.DAYTONA_API_KEY);
    if (!apiKey?.trim()) throw new Error("Daytona API key is unavailable");
    const client = new DaytonaClient({
      apiKey,
      apiUrl: env.DAYTONA_API_URL,
      organizationId,
      requestTimeoutMs: 4_000,
      target: env.DAYTONA_TARGET,
    });
    const volume = await client.getVolumeByName(env.DAYTONA_WORKSPACE_VOLUME);
    if (
      !volume ||
      volume.organizationId !== organizationId ||
      volume.state !== "ready" ||
      volume.errorReason
    ) {
      throw new Error("Daytona workspace volume is absent or not ready");
    }
    return DaytonaVolumeIdentitySchema.parse({
      organizationId: volume.organizationId,
      state: volume.state,
      volumeId: volume.id,
      volumeName: volume.name,
    });
  } catch (error) {
    throw new APIError(503, "unavailable_maintenance", "Daytona volume readiness failed", {
      cause: error,
      retriable: true,
    });
  }
}

function requiredDaytonaOrganizationId(env: AgentEnv): string {
  const organizationId = env.DAYTONA_ORG_ID?.trim();
  if (!organizationId) {
    throw new Error("DAYTONA_ORG_ID is required for release readiness");
  }
  return organizationId;
}

function releaseMismatch(message: string): APIError {
  return new APIError(409, "conflict_state_invalid", message, { retriable: false });
}
