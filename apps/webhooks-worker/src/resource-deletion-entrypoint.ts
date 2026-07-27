import { WorkerEntrypoint } from "cloudflare:workers";
import { WebhooksWorkerEnvSchema } from "@cheatcode/env";
import {
  createLogger,
  emitErrorEvent,
  safeErrorTelemetry,
  toAPIError,
} from "@cheatcode/observability";
import {
  InternalResourceDeletionRequestSchema,
  type ResourceDeletionServiceResult,
  ResourceDeletionServiceResultSchema,
} from "@cheatcode/types";
import { z } from "zod";
import {
  enqueueResourceDeletionWorkflow,
  type ResourceDeletionWorkflowEnv,
} from "./resource-deletion-workflow";

const ResourceDeletionCallerSchema = z
  .object({
    caller: z.literal("gateway"),
    capability: z.literal("resource-deletion"),
  })
  .strict();

type ResourceDeletionCaller = z.infer<typeof ResourceDeletionCallerSchema>;

/**
 * Capability-scoped RPC surface for durable resource deletion admission.
 * The default webhooks HTTP handler does not expose this destructive operation.
 */
export class ResourceDeletionEntrypoint extends WorkerEntrypoint<
  ResourceDeletionWorkflowEnv,
  ResourceDeletionCaller
> {
  public async enqueueResourceDeletion(input: unknown): Promise<ResourceDeletionServiceResult> {
    WebhooksWorkerEnvSchema.parse(this.env);
    ResourceDeletionCallerSchema.parse(this.ctx.props);
    try {
      const request = InternalResourceDeletionRequestSchema.parse(input);
      const jobId = await enqueueResourceDeletionWorkflow(this.env, request);
      return ResourceDeletionServiceResultSchema.parse({ jobId, ok: true });
    } catch (error) {
      const apiError = toAPIError(error);
      emitErrorEvent(this.env, {
        errorCategory: "webhook",
        errorCode: apiError.code,
        httpStatus: apiError.status,
        route: "rpc ResourceDeletionEntrypoint.enqueueResourceDeletion",
        workerName: "webhooks",
        ...safeErrorTelemetry(error),
      });
      createLogger().error("resource_deletion_rpc_failed", {
        apiCode: apiError.code,
        ...safeErrorTelemetry(error),
      });
      return { ok: false, retriable: apiError.retriable, status: apiError.status };
    }
  }
}
