import { assertDistinctHmacSecrets } from "@cheatcode/auth";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";

export function assertWebhooksServiceHostname(request: Request): void {
  if (new URL(request.url).hostname !== "webhooks.internal") {
    throw invalidInternalHost("Service-only webhooks route requires a service binding");
  }
}

export function assertWebhookReplayHostname(
  request: Request,
  environment: "development" | "production",
): void {
  const hostname = new URL(request.url).hostname;
  const isAllowed =
    environment === "production"
      ? hostname === "webhooks.trycheatcode.com"
      : hostname === "127.0.0.1" || hostname === "localhost";
  if (!isAllowed) {
    throw invalidInternalHost("Webhook replay route requires its canonical ingress");
  }
}

export interface WebhooksMaintenanceSecretBindings {
  GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET: WorkerSecret;
  INTERNAL_WEBHOOK_REPLAY_SECRET: WorkerSecret;
  RELEASE_DATABASE_READINESS_SECRET: WorkerSecret;
  WEBHOOKS_TO_AGENT_LIFECYCLE_SECRET: WorkerSecret;
}

export function requireWebhookReplaySecret(
  env: WebhooksMaintenanceSecretBindings,
): Promise<string> {
  return requireWebhooksMaintenanceSecrets(env).then((secrets) => secrets.webhookReplay);
}

export function requireResourceDeletionSecret(
  env: WebhooksMaintenanceSecretBindings,
): Promise<string> {
  return requireWebhooksMaintenanceSecrets(env).then((secrets) => secrets.resourceDeletion);
}

export function requireDatabaseReadinessSecret(
  env: WebhooksMaintenanceSecretBindings,
): Promise<string> {
  return requireWebhooksMaintenanceSecrets(env).then((secrets) => secrets.databaseReadiness);
}

export function requireAgentLifecycleSecret(
  env: WebhooksMaintenanceSecretBindings,
): Promise<string> {
  return requireWebhooksMaintenanceSecrets(env).then((secrets) => secrets.agentLifecycle);
}

async function requireWebhooksMaintenanceSecrets(env: WebhooksMaintenanceSecretBindings): Promise<{
  agentLifecycle: string;
  databaseReadiness: string;
  resourceDeletion: string;
  webhookReplay: string;
}> {
  try {
    const [agentLifecycle, databaseReadiness, resourceDeletion, webhookReplay] = await Promise.all([
      resolveRequiredSecret(env.WEBHOOKS_TO_AGENT_LIFECYCLE_SECRET),
      resolveRequiredSecret(env.RELEASE_DATABASE_READINESS_SECRET),
      resolveRequiredSecret(env.GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET),
      resolveRequiredSecret(env.INTERNAL_WEBHOOK_REPLAY_SECRET),
    ]);
    assertDistinctHmacSecrets([agentLifecycle, databaseReadiness, resourceDeletion, webhookReplay]);
    return { agentLifecycle, databaseReadiness, resourceDeletion, webhookReplay };
  } catch {
    // Secret-store failures share one bounded internal-maintenance error contract.
  }
  throw new APIError(
    503,
    "unavailable_maintenance",
    "Webhooks maintenance secrets are unavailable",
    {
      retriable: false,
    },
  );
}

async function resolveRequiredSecret(binding: WorkerSecret): Promise<string> {
  const secret = await resolveWorkerSecret(binding);
  if (!secret?.trim()) {
    throw new Error("Maintenance secret is missing");
  }
  return secret;
}

function invalidInternalHost(message: string): APIError {
  return new APIError(401, "auth_token_invalid", message, { retriable: false });
}
