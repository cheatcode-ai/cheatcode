import {
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

export function verifyAgentLifecycleRequest(input: AgentMaintenanceRequestInput): Promise<void> {
  return verifyAgentRequest(input);
}

async function verifyAgentRequest(input: AgentMaintenanceRequestInput): Promise<void> {
  const secret = await requireAgentMaintenanceSecret(
    input.secrets.WEBHOOKS_TO_AGENT_LIFECYCLE_SECRET,
  );
  await verifyInternalMaintenanceRequest({
    expectedAudience: "agent",
    expectedCapability: "agent-lifecycle",
    expectedIssuer: "webhooks",
    expectedMethod: "POST",
    expectedPathname: input.expectedPathname,
    rawBody: input.rawBody,
    request: input.request,
    secret,
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

async function requireAgentMaintenanceSecret(binding: WorkerSecret): Promise<string> {
  try {
    return await resolveRequiredSecret(binding);
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
