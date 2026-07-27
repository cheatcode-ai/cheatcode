import { WorkerEntrypoint } from "cloudflare:workers";
import { AgentWorkerEnvSchema } from "@cheatcode/env";
import {
  createLogger,
  emitErrorEvent,
  safeErrorTelemetry,
  toAPIError,
} from "@cheatcode/observability";
import {
  type AgentLifecycleServiceResult,
  InternalAgentStateDeleteRequestSchema,
  InternalStateDeleteResponseSchema,
} from "@cheatcode/types";
import { z } from "zod";
import { deleteAgentUserState } from "./agent-api-system-routes";
import type { AgentEnv } from "./agent-env";

const AgentLifecycleCallerSchema = z
  .object({
    caller: z.literal("webhooks"),
    capability: z.literal("agent-lifecycle"),
  })
  .strict();

type AgentLifecycleCaller = z.infer<typeof AgentLifecycleCallerSchema>;

/**
 * Capability-scoped RPC surface for destructive agent lifecycle operations.
 * Only callers holding this named service binding can invoke these methods.
 */
export class AgentLifecycleEntrypoint extends WorkerEntrypoint<AgentEnv, AgentLifecycleCaller> {
  public async deleteUserState(input: unknown): Promise<AgentLifecycleServiceResult> {
    AgentWorkerEnvSchema.parse(this.env);
    AgentLifecycleCallerSchema.parse(this.ctx.props);
    try {
      const request = InternalAgentStateDeleteRequestSchema.parse(input);
      return InternalStateDeleteResponseSchema.parse(await deleteAgentUserState(this.env, request));
    } catch (error) {
      const apiError = toAPIError(error);
      emitErrorEvent(this.env, {
        errorCategory: "agent",
        errorCode: apiError.code,
        httpStatus: apiError.status,
        route: "rpc AgentLifecycleEntrypoint.deleteUserState",
        workerName: "agent",
        ...safeErrorTelemetry(error),
      });
      createLogger().error("agent_lifecycle_rpc_failed", {
        apiCode: apiError.code,
        ...safeErrorTelemetry(error),
      });
      return { ok: false, retriable: apiError.retriable, status: apiError.status };
    }
  }
}
