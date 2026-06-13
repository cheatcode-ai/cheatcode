import { verifyInternalMaintenanceRequest } from "@cheatcode/auth";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";

export async function verifyAgentMaintenanceRequest(input: {
  rawBody: string;
  request: Request;
  secret: WorkerSecret | undefined;
}): Promise<void> {
  const secret = await readRequiredSecret(input.secret, "INTERNAL_MAINTENANCE_SECRET");
  await verifyInternalMaintenanceRequest({
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

async function readRequiredSecret(secret: WorkerSecret | undefined, name: string): Promise<string> {
  const value = await readOptionalSecret(secret, name);
  if (!value) {
    throw new APIError(503, "unavailable_maintenance", `${name} is not configured`, {
      hint: `Set ${name} in the agent Worker environment.`,
      retriable: false,
    });
  }
  return value;
}

async function readOptionalSecret(
  secret: WorkerSecret | undefined,
  name: string,
): Promise<string | undefined> {
  try {
    return await resolveWorkerSecret(secret);
  } catch {
    throw new APIError(503, "unavailable_maintenance", `${name} is unavailable`, {
      hint: `Verify the ${name} Cloudflare secret binding.`,
      retriable: false,
    });
  }
}
