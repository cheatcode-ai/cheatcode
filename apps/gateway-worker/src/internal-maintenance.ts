import { assertDistinctHmacSecrets } from "@cheatcode/auth";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";

export interface GatewayMaintenanceSecretBindings {
  GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET: WorkerSecret;
  RELEASE_DATABASE_READINESS_SECRET: WorkerSecret;
}

export async function requireResourceDeletionSecret(
  env: GatewayMaintenanceSecretBindings,
): Promise<string> {
  return (await requireGatewayMaintenanceSecrets(env)).resourceDeletion;
}

export function requireDatabaseReadinessSecret(
  env: GatewayMaintenanceSecretBindings,
): Promise<string> {
  return requireGatewayMaintenanceSecrets(env).then((secrets) => secrets.databaseReadiness);
}

async function requireGatewayMaintenanceSecrets(env: GatewayMaintenanceSecretBindings): Promise<{
  databaseReadiness: string;
  resourceDeletion: string;
}> {
  try {
    const [databaseReadiness, resourceDeletion] = await Promise.all([
      resolveRequiredSecret(env.RELEASE_DATABASE_READINESS_SECRET),
      resolveRequiredSecret(env.GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET),
    ]);
    assertDistinctHmacSecrets([databaseReadiness, resourceDeletion]);
    return { databaseReadiness, resourceDeletion };
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
