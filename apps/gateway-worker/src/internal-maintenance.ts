import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";

export interface GatewayMaintenanceSecretBindings {
  GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET: WorkerSecret;
  RELEASE_DATABASE_READINESS_SECRET: WorkerSecret;
}

export async function requireResourceDeletionSecret(
  env: GatewayMaintenanceSecretBindings,
): Promise<string> {
  return requireGatewayMaintenanceSecret(env.GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET);
}

export function requireDatabaseReadinessSecret(
  env: GatewayMaintenanceSecretBindings,
): Promise<string> {
  return requireGatewayMaintenanceSecret(env.RELEASE_DATABASE_READINESS_SECRET);
}

async function requireGatewayMaintenanceSecret(binding: WorkerSecret): Promise<string> {
  try {
    return await resolveRequiredSecret(binding);
  } catch {
    // Secret-store failures share one bounded internal-maintenance error contract.
  }
  throw new APIError(
    503,
    "unavailable_maintenance",
    "Gateway maintenance secrets are unavailable",
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
