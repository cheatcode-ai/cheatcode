import { createInternalMaintenanceHeaders } from "@cheatcode/auth";
import { APIError, readBoundedResponseJson } from "@cheatcode/observability";
import {
  INTERNAL_RESOURCE_DELETION_PATH,
  type InternalResourceDeletionRequest,
  InternalResourceDeletionRequestSchema,
} from "@cheatcode/types";
import { z } from "zod";
import {
  type GatewayMaintenanceSecretBindings,
  requireResourceDeletionSecret,
} from "./internal-maintenance";

const MAX_ENQUEUE_RESPONSE_BYTES = 16 * 1024;
const EnqueueResponseSchema = z
  .object({ jobId: z.string().uuid().nullable(), ok: z.literal(true) })
  .strict();

export interface ResourceDeletionEnqueueEnv extends GatewayMaintenanceSecretBindings {
  WEBHOOKS: Fetcher;
}

export async function enqueueResourceDeletion(
  env: ResourceDeletionEnqueueEnv,
  input: InternalResourceDeletionRequest,
): Promise<string | null> {
  const rawBody = JSON.stringify(InternalResourceDeletionRequestSchema.parse(input));
  const headers = await createInternalMaintenanceHeaders({
    audience: "webhooks",
    capability: "resource-deletion",
    issuer: "gateway",
    method: "POST",
    pathname: INTERNAL_RESOURCE_DELETION_PATH,
    rawBody,
    secret: await requireResourceDeletionSecret(env),
  });
  headers.set("content-type", "application/json");
  const response = await env.WEBHOOKS.fetch(
    `https://webhooks.internal${INTERNAL_RESOURCE_DELETION_PATH}`,
    { body: rawBody, headers, method: "POST" },
  );
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    throw new APIError(503, "unavailable_maintenance", "Resource deletion enqueue failed", {
      details: { status },
      retriable: true,
    });
  }
  const result = EnqueueResponseSchema.parse(
    await readBoundedResponseJson(response, MAX_ENQUEUE_RESPONSE_BYTES, "Webhooks Worker"),
  );
  return result.jobId;
}
