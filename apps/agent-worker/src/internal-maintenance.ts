import {
  assertDistinctHmacSecrets,
  assertInternalMaintenanceEnvelope,
  verifyInternalMaintenanceRequest,
} from "@cheatcode/auth";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";

interface AgentMaintenanceRequestInput {
  expectedPathname: string;
  rawBody: string;
  request: Request;
  secrets: AgentMaintenanceSecretBindings;
}

interface AgentMaintenanceSecretBindings {
  RELEASE_DATABASE_READINESS_SECRET: WorkerSecret;
  WEBHOOKS_TO_AGENT_LIFECYCLE_SECRET: WorkerSecret;
}

export function assertAgentInternalHostname(request: Request): void {
  if (new URL(request.url).hostname !== "agent.internal") {
    throw new APIError(401, "auth_token_invalid", "Internal agent route requires service binding", {
      retriable: false,
    });
  }
}

export function assertAgentLifecycleCapability(request: Request): void {
  assertInternalMaintenanceEnvelope(request, {
    audience: "agent",
    capability: "agent-lifecycle",
    issuer: "webhooks",
  });
}

export function assertAgentDatabaseReadinessCapability(request: Request): void {
  assertInternalMaintenanceEnvelope(request, {
    audience: "agent",
    capability: "database-readiness",
    issuer: "gateway",
  });
}

export function assertAgentDurableObjectStorageCapability(request: Request): void {
  assertInternalMaintenanceEnvelope(request, {
    audience: "agent",
    capability: "durable-object-schema",
    issuer: "gateway",
  });
}

export function verifyAgentLifecycleRequest(input: AgentMaintenanceRequestInput): Promise<void> {
  return verifyAgentRequest(input, "agent-lifecycle");
}

export function verifyAgentDatabaseReadinessRequest(
  input: AgentMaintenanceRequestInput,
): Promise<void> {
  return verifyAgentRequest(input, "database-readiness");
}

export function verifyAgentDurableObjectStorageRequest(
  input: AgentMaintenanceRequestInput,
): Promise<void> {
  return verifyAgentRequest(input, "durable-object-schema");
}

async function verifyAgentRequest(
  input: AgentMaintenanceRequestInput,
  capability: "agent-lifecycle" | "database-readiness" | "durable-object-schema",
): Promise<void> {
  const secrets = await requireAgentMaintenanceSecrets(input.secrets);
  await verifyInternalMaintenanceRequest({
    expectedAudience: "agent",
    expectedCapability: capability,
    expectedIssuer: capability === "agent-lifecycle" ? "webhooks" : "gateway",
    expectedMethod: "POST",
    expectedPathname: input.expectedPathname,
    rawBody: input.rawBody,
    request: input.request,
    secret: capability === "agent-lifecycle" ? secrets.agentLifecycle : secrets.databaseReadiness,
  });
}

export function parseInternalMaintenanceJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new APIError(400, "invalid_request_body", "Internal maintenance body must be JSON", {
      retriable: false,
    });
  }
}

async function requireAgentMaintenanceSecrets(env: AgentMaintenanceSecretBindings): Promise<{
  agentLifecycle: string;
  databaseReadiness: string;
}> {
  try {
    const [agentLifecycle, databaseReadiness] = await Promise.all([
      resolveRequiredSecret(env.WEBHOOKS_TO_AGENT_LIFECYCLE_SECRET),
      resolveRequiredSecret(env.RELEASE_DATABASE_READINESS_SECRET),
    ]);
    assertDistinctHmacSecrets([agentLifecycle, databaseReadiness]);
    return { agentLifecycle, databaseReadiness };
  } catch {
    throw new APIError(
      503,
      "unavailable_maintenance",
      "Agent maintenance secrets are unavailable",
      {
        hint: "Configure two distinct maintenance secrets containing at least 32 UTF-8 bytes.",
        retriable: false,
      },
    );
  }
}

async function resolveRequiredSecret(binding: WorkerSecret): Promise<string> {
  const secret = await resolveWorkerSecret(binding);
  if (!secret?.trim()) {
    throw new Error("Maintenance secret is missing");
  }
  return secret;
}
