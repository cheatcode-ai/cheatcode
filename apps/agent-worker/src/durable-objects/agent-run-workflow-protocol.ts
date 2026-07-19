import { z } from "zod";
import { StartRunInputSchema } from "./agent-run-schemas";

export const AGENT_RUN_WORKFLOW_ADMITTED_KEY = "workflow_admitted";
export const AGENT_RUN_WORKFLOW_EXECUTION_STARTED_KEY = "workflow_execution_started";
export const AGENT_RUN_WORKFLOW_GENERATION_KEY = "workflow_generation";
export const AGENT_RUN_WORKFLOW_ID_KEY = "workflow_id";
export const AGENT_RUN_WORKFLOW_INPUT_HASH_KEY = "workflow_input_hash";
export const AGENT_RUN_WORKFLOW_LEASE_EXPIRES_AT_KEY = "workflow_lease_expires_at";
export const AGENT_RUN_WORKFLOW_PENDING_INPUT_KEY = "workflow_pending_input";
export const AGENT_RUN_WORKFLOW_RETRY_ATTEMPT_KEY = "workflow_retry_attempt";
export const AGENT_RUN_WORKFLOW_RETRY_AT_KEY = "workflow_retry_at";

export const AGENT_RUN_EXECUTION_EPOCH_MS = 4 * 60 * 1_000;
export const AGENT_RUN_EXECUTION_LEASE_GRACE_MS = 90 * 1_000;
export const AGENT_RUN_EXECUTION_HEARTBEAT_MS = 15 * 1_000;
export const AGENT_RUN_WORKFLOW_MAX_RESPONSE_BYTES = 8 * 1_024;
export const AGENT_RUN_WORKFLOW_ROLLOVER_MAX_RESPONSE_BYTES = 256 * 1_024;
export const AGENT_RUN_WORKFLOW_EXECUTION_RETRY_LIMIT = 5;
export const AGENT_RUN_WORKFLOW_FAILURE_RETRY_LIMIT = 5;
export const AGENT_RUN_WORKFLOW_ROLLOVER_RETRY_LIMIT = 5;
// This is a generation boundary, not a run cap. The successor keeps the same
// semantic run while resetting Workflow step and subrequest accounting.
export const AGENT_RUN_WORKFLOW_ROLLOVER_EPOCHS = 1_000;
export const AGENT_RUN_WORKFLOW_RETRY_BASE_MS = 5_000;
export const AGENT_RUN_WORKFLOW_RETRY_MAX_MS = 60_000;

const CLOUDFLARE_WORKFLOW_DEFAULT_SUBREQUEST_LIMIT = 10_000;
const EXECUTION_SUBREQUESTS_PER_ATTEMPT = 1;
const FAILURE_SUBREQUESTS_PER_ATTEMPT = 1;
const ROLLOVER_RESERVATION_SUBREQUESTS_PER_ATTEMPT = 1;
// A colliding successor creation can create, get, inspect, and restart the exact
// instance before one retry attempt returns.
const SUCCESSOR_CREATION_SUBREQUESTS_PER_ATTEMPT = 4;
const AGENT_RUN_WORKFLOW_MAX_SUBREQUESTS =
  AGENT_RUN_WORKFLOW_ROLLOVER_EPOCHS *
    (AGENT_RUN_WORKFLOW_EXECUTION_RETRY_LIMIT + 1) *
    EXECUTION_SUBREQUESTS_PER_ATTEMPT +
  (AGENT_RUN_WORKFLOW_ROLLOVER_RETRY_LIMIT + 1) * ROLLOVER_RESERVATION_SUBREQUESTS_PER_ATTEMPT +
  (AGENT_RUN_WORKFLOW_ROLLOVER_RETRY_LIMIT + 1) * SUCCESSOR_CREATION_SUBREQUESTS_PER_ATTEMPT +
  (AGENT_RUN_WORKFLOW_FAILURE_RETRY_LIMIT + 1) * FAILURE_SUBREQUESTS_PER_ATTEMPT;

if (AGENT_RUN_WORKFLOW_MAX_SUBREQUESTS > CLOUDFLARE_WORKFLOW_DEFAULT_SUBREQUEST_LIMIT) {
  throw new Error("AgentRun Workflow rollover exceeds its Cloudflare subrequest budget.");
}

const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const WorkflowGenerationSchema = z.number().int().nonnegative().safe();

export const AgentRunWorkflowPayloadSchema = z
  .object({
    generation: WorkflowGenerationSchema,
    input: StartRunInputSchema,
    inputHash: Sha256HexSchema,
  })
  .strict();

export type AgentRunWorkflowPayload = z.infer<typeof AgentRunWorkflowPayloadSchema>;

export const AgentRunWorkflowCallbackInputSchema = AgentRunWorkflowPayloadSchema.extend({
  workflowInstanceId: z.string().min(1).max(100),
}).strict();

export type AgentRunWorkflowCallbackInput = z.infer<typeof AgentRunWorkflowCallbackInputSchema>;

export const AgentRunWorkflowFailureInputSchema = z
  .object({
    generation: WorkflowGenerationSchema,
    inputHash: Sha256HexSchema,
    message: z.string().trim().min(1).max(500),
    workflowInstanceId: z.string().min(1).max(100),
  })
  .strict();

export type AgentRunWorkflowFailureInput = z.infer<typeof AgentRunWorkflowFailureInputSchema>;

export const AgentRunWorkflowEpochResultSchema = z
  .object({
    outcome: z.enum(["continue", "continued", "deleted", "terminal"]),
    status: z.string().min(1).max(32),
  })
  .strict();

export type AgentRunWorkflowEpochResult = z.infer<typeof AgentRunWorkflowEpochResultSchema>;

const AgentRunWorkflowRolloverTerminalResultSchema = z
  .object({
    outcome: z.enum(["continued", "deleted", "terminal"]),
    status: z.string().min(1).max(32),
  })
  .strict();

const AgentRunWorkflowRolloverReservedResultSchema = z
  .object({
    outcome: z.literal("reserved"),
    payload: AgentRunWorkflowPayloadSchema,
    status: z.string().min(1).max(32),
    workflowInstanceId: z.string().min(1).max(100),
  })
  .strict();

export const AgentRunWorkflowRolloverResultSchema = z.union([
  AgentRunWorkflowRolloverTerminalResultSchema,
  AgentRunWorkflowRolloverReservedResultSchema,
]);

export type AgentRunWorkflowRolloverResult = z.infer<typeof AgentRunWorkflowRolloverResultSchema>;

export function agentRunWorkflowInstanceId(runId: string, generation: number): string {
  return `agent-run-${runId}-${generation}`;
}

export async function agentRunWorkflowInputHash(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(StartRunInputSchema.parse(input)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
