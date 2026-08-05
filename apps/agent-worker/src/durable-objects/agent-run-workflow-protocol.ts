import type { LogicalModelId } from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import { z } from "zod";
import { StartRunInputSchema } from "./agent-run-schemas";

export const AGENT_RUN_WORKFLOW_ADMITTED_KEY = "workflow_admitted";
export const AGENT_RUN_WORKFLOW_ID_KEY = "workflow_id";
export const AGENT_RUN_WORKFLOW_INPUT_HASH_KEY = "workflow_input_hash";
export const AGENT_RUN_WORKFLOW_PENDING_INPUT_KEY = "workflow_pending_input";
export const AGENT_RUN_WORKFLOW_RECONCILE_AT_KEY = "workflow_reconcile_at";
export const AGENT_RUN_WORKFLOW_RETRY_ATTEMPT_KEY = "workflow_retry_attempt";
export const AGENT_RUN_WORKFLOW_RETRY_AT_KEY = "workflow_retry_at";
export const AGENT_RUN_WORKFLOW_UNKNOWN_ATTEMPT_KEY = "workflow_unknown_attempt";

export const AGENT_RUN_WORKFLOW_MAX_RESPONSE_BYTES = 8 * 1_024;
export const AGENT_RUN_WORKFLOW_FAILURE_RETRY_LIMIT = 5;
export const AGENT_RUN_WORKFLOW_RECONCILE_INTERVAL_MS = 10_000;
export const AGENT_RUN_WORKFLOW_RETRY_BASE_MS = 5_000;
export const AGENT_RUN_WORKFLOW_RETRY_MAX_MS = 60_000;
export const AGENT_RUN_WORKFLOW_UNKNOWN_ATTEMPT_LIMIT = 3;

const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const WorkflowCallbackOutcomeSchema = z.enum(["current", "deleted", "terminal"]);

export const AgentRunWorkflowCallbackResponseSchema = z.union([
  z.strictObject({ outcome: WorkflowCallbackOutcomeSchema }),
  z.strictObject({
    appendedCount: z.number().int().nonnegative(),
    outcome: WorkflowCallbackOutcomeSchema,
  }),
]);

export const AgentRunWorkflowPayloadSchema = z.strictObject({
  input: StartRunInputSchema,
  inputHash: Sha256HexSchema,
});

export type AgentRunWorkflowPayload = z.infer<typeof AgentRunWorkflowPayloadSchema>;

export interface AgentRunWorkflowCallbackInput extends AgentRunWorkflowPayload {
  workflowInstanceId: string;
}

export interface AgentRunWorkflowEventInput extends AgentRunWorkflowCallbackInput {
  chunks: UIMessageChunk[];
  eventKey: string;
}

export interface AgentRunWorkflowModelInput extends AgentRunWorkflowCallbackInput {
  logicalModelId: LogicalModelId;
}

export interface AgentRunWorkflowStageInput extends AgentRunWorkflowCallbackInput {
  stage: string;
}

export interface AgentRunWorkflowFailureInput {
  code: string;
  inputHash: string;
  message: string;
  retriable: boolean;
  workflowInstanceId: string;
}

export function agentRunWorkflowInstanceId(runId: string): string {
  return `agent-run-${runId}`;
}

export async function agentRunWorkflowInputHash(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(StartRunInputSchema.parse(input)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
