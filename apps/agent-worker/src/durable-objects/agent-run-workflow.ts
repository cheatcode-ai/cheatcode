import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { readBoundedResponseJson, readBoundedResponseText } from "@cheatcode/observability";
import type { AgentRun } from "./agent-run";
import {
  AGENT_RUN_WORKFLOW_EXECUTION_RETRY_LIMIT,
  AGENT_RUN_WORKFLOW_FAILURE_RETRY_LIMIT,
  AGENT_RUN_WORKFLOW_MAX_RESPONSE_BYTES,
  AGENT_RUN_WORKFLOW_ROLLOVER_EPOCHS,
  AGENT_RUN_WORKFLOW_ROLLOVER_MAX_RESPONSE_BYTES,
  AGENT_RUN_WORKFLOW_ROLLOVER_RETRY_LIMIT,
  type AgentRunWorkflowEpochResult,
  AgentRunWorkflowEpochResultSchema,
  type AgentRunWorkflowPayload,
  AgentRunWorkflowPayloadSchema,
  type AgentRunWorkflowRolloverResult,
  AgentRunWorkflowRolloverResultSchema,
  agentRunWorkflowInputHash,
  agentRunWorkflowInstanceId,
} from "./agent-run-workflow-protocol";

const EXECUTION_EPOCH_STEP = {
  // Keep every retry gap inside the DO's short waitUntil bridge. A longer
  // backoff could evict the sole in-memory coroutine between ownership calls.
  retries: {
    limit: AGENT_RUN_WORKFLOW_EXECUTION_RETRY_LIMIT,
    delay: "5 seconds",
    backoff: "constant",
  },
  timeout: "5 minutes",
} as const;
const FAILURE_STEP = {
  retries: {
    limit: AGENT_RUN_WORKFLOW_FAILURE_RETRY_LIMIT,
    delay: "10 seconds",
    backoff: "exponential",
  },
  timeout: "2 minutes",
} as const;
const ROLLOVER_STEP = {
  retries: {
    limit: AGENT_RUN_WORKFLOW_ROLLOVER_RETRY_LIMIT,
    delay: "5 seconds",
    backoff: "constant",
  },
  timeout: "2 minutes",
} as const;

interface AgentRunWorkflowEnv extends AgentRunWorkflowBindings {
  AGENT_RUN: DurableObjectNamespace<AgentRun>;
}

export interface AgentRunWorkflowBindings {
  AGENT_RUN_WORKFLOW: Workflow<AgentRunWorkflowPayload>;
  CHEATCODE_RELEASE_GATE: "closed" | "draining" | "open";
}

/** Durable owner for one semantic AgentRun; execution is renewed in bounded, retry-safe epochs. */
export class AgentRunWorkflow extends WorkflowEntrypoint<
  AgentRunWorkflowEnv,
  AgentRunWorkflowPayload
> {
  public override async run(
    event: Readonly<WorkflowEvent<AgentRunWorkflowPayload>>,
    step: WorkflowStep,
  ): Promise<AgentRunWorkflowEpochResult> {
    if (this.env.CHEATCODE_RELEASE_GATE === "closed") {
      throw new NonRetryableError(
        "AgentRun Workflow is fenced by a closed release",
        "AgentRunReleaseGateClosed",
      );
    }
    const payload = await parseWorkflowPayload(event.payload);
    try {
      for (let epoch = 0; epoch < AGENT_RUN_WORKFLOW_ROLLOVER_EPOCHS; epoch += 1) {
        const result = await step.do("hold AgentRun execution epoch", EXECUTION_EPOCH_STEP, () =>
          executeEpoch(this.env, event.instanceId, payload),
        );
        if (result.outcome !== "continue") {
          return result;
        }
      }
      return continueAgentRunGeneration(this.env, step, event.instanceId, payload);
    } catch (error) {
      await step.do("terminalize lost AgentRun ownership", FAILURE_STEP, () =>
        terminalizeOwnershipFailure(this.env, event.instanceId, payload),
      );
      throw error;
    }
  }
}

export async function admitAgentRunWorkflow(
  env: AgentRunWorkflowBindings,
  payload: AgentRunWorkflowPayload,
): Promise<string> {
  if (env.CHEATCODE_RELEASE_GATE === "closed") {
    throw new Error("AgentRun Workflow admission is fenced by a closed release.");
  }
  const id = agentRunWorkflowInstanceId(payload.input.runId, payload.generation);
  try {
    const instance = await env.AGENT_RUN_WORKFLOW.create({
      id,
      params: payload,
      retention: { errorRetention: "30 days", successRetention: "1 day" },
    });
    return instance.id;
  } catch (createError) {
    return reuseAgentRunWorkflow(env.AGENT_RUN_WORKFLOW, id, createError);
  }
}

async function reuseAgentRunWorkflow(
  workflow: Workflow<AgentRunWorkflowPayload>,
  id: string,
  createError: unknown,
): Promise<string> {
  try {
    const instance = await workflow.get(id);
    const { status } = await instance.status();
    if (status === "unknown") {
      throw createError;
    }
    if (status === "errored" || status === "terminated") {
      await instance.restart();
    }
    return instance.id;
  } catch {
    throw createError;
  }
}

async function continueAgentRunGeneration(
  env: AgentRunWorkflowEnv,
  step: WorkflowStep,
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
): Promise<AgentRunWorkflowEpochResult> {
  const reservation = await step.do("reserve AgentRun successor", ROLLOVER_STEP, () =>
    reserveAgentRunSuccessor(env, workflowInstanceId, payload),
  );
  if (reservation.outcome !== "reserved") {
    return AgentRunWorkflowEpochResultSchema.parse(reservation);
  }
  await step.do("create AgentRun successor", ROLLOVER_STEP, async () => {
    const admittedId = await admitAgentRunWorkflow(env, reservation.payload);
    if (admittedId !== reservation.workflowInstanceId) {
      throw new Error("AgentRun Workflow successor admitted an unexpected instance id.");
    }
    return { workflowInstanceId: admittedId };
  });
  return AgentRunWorkflowEpochResultSchema.parse({
    outcome: "continued",
    status: reservation.status,
  });
}

async function reserveAgentRunSuccessor(
  env: AgentRunWorkflowEnv,
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
): Promise<AgentRunWorkflowRolloverResult> {
  const stub = env.AGENT_RUN.get(env.AGENT_RUN.idFromName(payload.input.runId));
  const response = await stub.fetch("https://agent-run.internal/workflow/rollover", {
    body: JSON.stringify({ ...payload, workflowInstanceId }),
    method: "POST",
  });
  if (!response.ok) {
    const detail = await readBoundedResponseText(
      response,
      AGENT_RUN_WORKFLOW_ROLLOVER_MAX_RESPONSE_BYTES,
      "AgentRun Workflow rollover",
    );
    const message = `AgentRun Workflow rollover returned HTTP ${response.status}: ${detail.slice(0, 300)}`;
    if (response.status >= 400 && response.status < 500) {
      throw new NonRetryableError(message, "AgentRunRolloverContractError");
    }
    throw new Error(message);
  }
  return AgentRunWorkflowRolloverResultSchema.parse(
    await readBoundedResponseJson(
      response,
      AGENT_RUN_WORKFLOW_ROLLOVER_MAX_RESPONSE_BYTES,
      "AgentRun Workflow rollover",
    ),
  );
}

async function parseWorkflowPayload(value: unknown): Promise<AgentRunWorkflowPayload> {
  const parsed = AgentRunWorkflowPayloadSchema.safeParse(value);
  if (!parsed.success) {
    throw new NonRetryableError("Invalid AgentRun Workflow payload", "AgentRunPayloadError");
  }
  if ((await agentRunWorkflowInputHash(parsed.data.input)) !== parsed.data.inputHash) {
    throw new NonRetryableError(
      "AgentRun Workflow payload hash mismatch",
      "AgentRunPayloadHashError",
    );
  }
  return parsed.data;
}

async function executeEpoch(
  env: AgentRunWorkflowEnv,
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
): Promise<AgentRunWorkflowEpochResult> {
  const stub = env.AGENT_RUN.get(env.AGENT_RUN.idFromName(payload.input.runId));
  const response = await stub.fetch("https://agent-run.internal/workflow/execute", {
    body: JSON.stringify({ ...payload, workflowInstanceId }),
    method: "POST",
  });
  if (!response.ok) {
    const detail = await readBoundedResponseText(
      response,
      AGENT_RUN_WORKFLOW_MAX_RESPONSE_BYTES,
      "AgentRun execution epoch",
    );
    const message = `AgentRun execution epoch returned HTTP ${response.status}: ${detail.slice(0, 300)}`;
    if (response.status >= 400 && response.status < 500) {
      throw new NonRetryableError(message, "AgentRunExecutionContractError");
    }
    throw new Error(message);
  }
  return AgentRunWorkflowEpochResultSchema.parse(
    await readBoundedResponseJson(
      response,
      AGENT_RUN_WORKFLOW_MAX_RESPONSE_BYTES,
      "AgentRun execution epoch",
    ),
  );
}

async function terminalizeOwnershipFailure(
  env: AgentRunWorkflowEnv,
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
): Promise<{ ok: true }> {
  const stub = env.AGENT_RUN.get(env.AGENT_RUN.idFromName(payload.input.runId));
  const response = await stub.fetch("https://agent-run.internal/workflow/failed", {
    body: JSON.stringify({
      inputHash: payload.inputHash,
      generation: payload.generation,
      message: "Durable AgentRun execution ownership failed.",
      workflowInstanceId,
    }),
    method: "POST",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`AgentRun ownership terminalization returned HTTP ${response.status}`);
  }
  await response.body?.cancel().catch(() => undefined);
  return { ok: true };
}
