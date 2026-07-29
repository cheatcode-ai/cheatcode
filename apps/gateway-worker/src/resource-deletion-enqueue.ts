import { APIError } from "@cheatcode/observability";
import {
  type InternalResourceDeletionRequest,
  InternalResourceDeletionRequestSchema,
  type ResourceDeletionServiceBinding,
  ResourceDeletionServiceResultSchema,
} from "@cheatcode/types/internal";

export interface ResourceDeletionEnqueueEnv {
  RESOURCE_DELETION: ResourceDeletionServiceBinding;
}

export async function enqueueResourceDeletion(
  env: ResourceDeletionEnqueueEnv,
  input: InternalResourceDeletionRequest,
): Promise<string | null> {
  const request = InternalResourceDeletionRequestSchema.parse(input);
  let result: Awaited<ReturnType<ResourceDeletionServiceBinding["enqueueResourceDeletion"]>>;
  try {
    result = ResourceDeletionServiceResultSchema.parse(
      await env.RESOURCE_DELETION.enqueueResourceDeletion(request),
    );
  } catch (error) {
    throw new APIError(503, "unavailable_maintenance", "Resource deletion enqueue failed", {
      cause: error,
      retriable: true,
    });
  }
  if (!result.ok) {
    throw new APIError(503, "unavailable_maintenance", "Resource deletion enqueue failed", {
      details: { status: result.status },
      retriable: result.retriable,
    });
  }
  return result.jobId;
}
