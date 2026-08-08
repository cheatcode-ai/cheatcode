import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  createLogger,
  emitErrorEvent,
  emitUserEvent,
  readBoundedResponseJson,
  readBoundedResponseText,
  safeErrorTelemetry,
} from "@cheatcode/observability";
import type { ModelMessage, ToolResultPart, UIMessageChunk } from "ai";
import { z } from "zod";
import type { AgentRun } from "./agent-run";
import type { AgentRunEnv } from "./agent-run-env";
import { toAgentRunStreamError } from "./agent-run-errors";
import {
  canonicalResearchReport,
  isResearchReportTool,
} from "./agent-run-research-response-support";
import {
  agentToolCallUiChunks,
  agentToolErrorUiChunks,
  agentToolResultUiChunks,
} from "./agent-run-tool-ui";
import {
  AGENT_RUN_WORKFLOW_FAILURE_RETRY_LIMIT,
  AGENT_RUN_WORKFLOW_MAX_RESPONSE_BYTES,
  type AgentRunWorkflowCallbackInput,
  AgentRunWorkflowCallbackResponseSchema,
  type AgentRunWorkflowEventInput,
  type AgentRunWorkflowPayload,
  AgentRunWorkflowPayloadSchema,
  agentRunWorkflowInputHash,
  agentRunWorkflowInstanceId,
} from "./agent-run-workflow-protocol";
import {
  cleanupWorkflowAgentRun,
  executeWorkflowToolStep,
  finalizeWorkflowAppBuilder,
  generateWorkflowModelStep,
  prepareWorkflowAgentRun,
  type WorkflowAgentState,
  WorkflowAgentStateSchema,
  type WorkflowModelStepResult,
  WorkflowModelStepResultSchema,
  type WorkflowToolStepResult,
  WorkflowToolStepResultSchema,
} from "./agent-run-workflow-runtime";

// A stopped Daytona sandbox can temporarily reject starts while its host recovers.
// Keep that provider recovery inside the durable preparation step so a transient
// host event does not become a user-visible failed run.
const PREPARE_STEP = stepConfig("10 minutes", 6);
const MODEL_STEP = stepConfig("5 minutes", 3);
const TOOL_STEP = stepConfig("15 minutes", 2);
const STATE_STEP = stepConfig("2 minutes", 5);
const CLEANUP_STEP = stepConfig("5 minutes", 5);
const FAILURE_STEP = stepConfig("2 minutes", AGENT_RUN_WORKFLOW_FAILURE_RETRY_LIMIT);
const JsonValueSchema = z.json();

interface AgentRunWorkflowEnv extends AgentRunEnv, AgentRunWorkflowBindings {
  AGENT_RUN: DurableObjectNamespace<AgentRun>;
}

export interface AgentRunWorkflowBindings {
  AGENT_RUN_WORKFLOW: Workflow<AgentRunWorkflowPayload>;
}

/** Durable, step-granular owner for one semantic AgentRun. */
export class AgentRunWorkflow extends WorkflowEntrypoint<
  AgentRunWorkflowEnv,
  AgentRunWorkflowPayload
> {
  public override async run(
    event: Readonly<WorkflowEvent<AgentRunWorkflowPayload>>,
    step: WorkflowStep,
  ): Promise<{ status: "completed" }> {
    const payload = await parseWorkflowPayload(event.payload);
    let cleanupInput = payload.input;
    try {
      const state = WorkflowAgentStateSchema.parse(
        JSON.parse(
          await step.do("prepare AgentRun", PREPARE_STEP, async () =>
            serializeWorkflowValue(
              await prepareWorkflowAgentRun(this.env, event.instanceId, payload),
            ),
          ),
        ),
      );
      cleanupInput = state.input;
      await runAgentLoop(this.env, step, event.instanceId, payload, state);
      await step.do("finalize app preview", STATE_STEP, () =>
        finalizeWorkflowAppBuilder(this.env, event.instanceId, payload, state),
      );
      await step.do("complete AgentRun", STATE_STEP, () =>
        completeAgentRun(this.env, event.instanceId, payload),
      );
      return { status: "completed" };
    } catch (error) {
      const failure = toAgentRunStreamError(error);
      recordWorkflowFailure(this.env, payload, event.instanceId, failure, error);
      await step.do("fail AgentRun", FAILURE_STEP, () =>
        failAgentRun(this.env, event.instanceId, payload, failure),
      );
      throw error;
    } finally {
      await step.do("clean up AgentRun", CLEANUP_STEP, () =>
        cleanupWorkflowAgentRun(this.env, event.instanceId, payload, cleanupInput),
      );
    }
  }
}

function recordWorkflowFailure(
  env: AgentRunWorkflowEnv,
  payload: AgentRunWorkflowPayload,
  workflowInstanceId: string,
  failure: ReturnType<typeof toAgentRunStreamError>,
  error: unknown,
): void {
  const telemetry = safeErrorTelemetry(error);
  emitErrorEvent(env, {
    errorCategory: "agent_run_workflow",
    errorCode: failure.code,
    route: "agent-run-workflow",
    runId: payload.input.runId,
    userId: payload.input.userId,
    workerName: "agent-worker",
    ...(env.CHEATCODE_RELEASE_SHA ? { versionTag: env.CHEATCODE_RELEASE_SHA } : {}),
    ...telemetry,
  });
  createLogger({
    runId: payload.input.runId,
    threadId: payload.input.threadId,
    userId: payload.input.userId,
  }).error("agent_run_workflow_failed", {
    failureCode: failure.code,
    workflowInstanceId,
    ...telemetry,
  });
}

export async function admitAgentRunWorkflow(
  env: AgentRunWorkflowBindings,
  payload: AgentRunWorkflowPayload,
): Promise<string> {
  const id = agentRunWorkflowInstanceId(payload.input.runId);
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

async function runAgentLoop(
  env: AgentRunWorkflowEnv,
  workflowStep: WorkflowStep,
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
  initialState: WorkflowAgentState,
): Promise<void> {
  let state = initialState;
  let nextToolStepIndex = 1;
  for (let stepIndex = 0; ; stepIndex += 1) {
    const model = await executeModelWorkflowStep({
      env,
      payload,
      state,
      stepIndex,
      workflowInstanceId,
      workflowStep,
    });
    state = await publishModelStep(
      env,
      workflowStep,
      workflowInstanceId,
      payload,
      state,
      model,
      stepIndex,
    );
    if (model.step.toolCalls.length === 0) {
      await publishClosingBackstopIfNeeded(env, workflowStep, workflowInstanceId, payload, state);
      return;
    }
    const toolTurn = await executeToolWorkflowSteps({
      env,
      model,
      payload,
      state,
      stepIndex,
      firstToolStepIndex: nextToolStepIndex,
      workflowInstanceId,
      workflowStep,
    });
    nextToolStepIndex += toolTurn.results.length;
    state = toolTurn.state;
    state = WorkflowAgentStateSchema.parse({
      ...state,
      messages: [...state.messages, workflowJsonValue(toolResultMessage(toolTurn.results))],
    });
    if (toolTurn.results.some((result) => canonicalResearchReport(result) !== undefined)) {
      return;
    }
    if (
      state.input.runIntent === "skill-creator" &&
      toolTurn.results.some(
        (result) => result.toolCall.toolName === "skill_create" && !result.error,
      )
    ) {
      await publishClosingBackstopIfNeeded(env, workflowStep, workflowInstanceId, payload, state);
      return;
    }
  }
}

async function executeModelWorkflowStep(input: {
  env: AgentRunWorkflowEnv;
  payload: AgentRunWorkflowPayload;
  state: WorkflowAgentState;
  stepIndex: number;
  workflowInstanceId: string;
  workflowStep: WorkflowStep;
}): Promise<WorkflowModelStepResult> {
  const serialized = await input.workflowStep.do(
    `generate model turn ${input.stepIndex}`,
    MODEL_STEP,
    async () =>
      serializeWorkflowValue(
        await generateWorkflowModelStep(
          input.env,
          input.workflowInstanceId,
          input.payload,
          input.state,
        ),
      ),
  );
  return WorkflowModelStepResultSchema.parse(JSON.parse(serialized));
}

async function executeToolWorkflowSteps(input: {
  env: AgentRunWorkflowEnv;
  firstToolStepIndex: number;
  model: WorkflowModelStepResult;
  payload: AgentRunWorkflowPayload;
  state: WorkflowAgentState;
  stepIndex: number;
  workflowInstanceId: string;
  workflowStep: WorkflowStep;
}): Promise<{ results: WorkflowToolStepResult[]; state: WorkflowAgentState }> {
  let state = input.state;
  const results: WorkflowToolStepResult[] = [];
  for (const [toolIndex, toolCall] of input.model.step.toolCalls.entries()) {
    const toolStepIndex = input.firstToolStepIndex + toolIndex;
    await publishToolStart({ ...input, toolCall, toolIndex, toolStepIndex });
    const result = await executeToolWorkflowStep({ ...input, state, toolCall, toolIndex });
    results.push(result);
    state = await publishToolStep(
      input.env,
      input.workflowStep,
      input.workflowInstanceId,
      input.payload,
      state,
      result,
      input.stepIndex,
      toolIndex,
      toolStepIndex,
    );
  }
  return { results, state };
}

async function publishToolStart(
  input: Parameters<typeof executeToolWorkflowSteps>[0] & {
    toolCall: WorkflowModelStepResult["step"]["toolCalls"][number];
    toolIndex: number;
    toolStepIndex: number;
  },
): Promise<void> {
  await input.workflowStep.do(
    `publish tool start ${input.stepIndex}.${input.toolIndex}`,
    STATE_STEP,
    async () => {
      emitUserEvent(input.env, {
        eventName: "step_started",
        runId: input.payload.input.runId,
        stepIdx: input.toolStepIndex,
        stepType: "tool",
        toolName: input.toolCall.toolName,
        userId: input.payload.input.userId,
      });
      await appendWorkflowEvent(
        input.env,
        workflowCallback(input.payload, input.workflowInstanceId),
        `tool-start:${input.stepIndex}:${input.toolIndex}`,
        agentToolCallUiChunks({
          args: input.toolCall.input,
          toolCallId: input.toolCall.toolCallId,
          toolName: input.toolCall.toolName,
        }),
      );
    },
  );
}

async function executeToolWorkflowStep(
  input: Parameters<typeof executeToolWorkflowSteps>[0] & {
    state: WorkflowAgentState;
    toolCall: WorkflowModelStepResult["step"]["toolCalls"][number];
    toolIndex: number;
  },
): Promise<WorkflowToolStepResult> {
  const serialized = await input.workflowStep.do(
    `execute tool ${input.stepIndex}.${input.toolIndex}`,
    TOOL_STEP,
    async () =>
      serializeWorkflowValue(
        await executeWorkflowToolStep(
          input.env,
          input.workflowInstanceId,
          input.payload,
          input.state,
          input.toolCall,
        ),
      ),
  );
  return WorkflowToolStepResultSchema.parse(JSON.parse(serialized));
}

async function publishModelStep(
  env: AgentRunWorkflowEnv,
  workflowStep: WorkflowStep,
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
  state: WorkflowAgentState,
  model: WorkflowModelStepResult,
  stepIndex: number,
): Promise<WorkflowAgentState> {
  const chunks: UIMessageChunk[] = [];
  if (model.fallback) {
    chunks.push({ data: { ...model.fallback, v: 1 }, type: "data-model-fallback" });
  }
  const modelText = model.step.toolCalls.some((toolCall) => isResearchReportTool(toolCall.toolName))
    ? ""
    : model.step.text;
  const text = modelText.trim();
  if (text.length > 0) {
    const id = `answer-${stepIndex}`;
    chunks.push(
      { id, type: "text-start" },
      { delta: modelText, id, type: "text-delta" },
      { id, type: "text-end" },
    );
  }
  await workflowStep.do(`publish model turn ${stepIndex}`, STATE_STEP, async () => {
    const callback = workflowCallback(payload, workflowInstanceId);
    await requireCurrent(
      await agentRunStub(env, payload.input.runId).persistWorkflowModel({
        ...callback,
        logicalModelId: model.logicalModelId,
      }),
      "persist Workflow model",
    );
    await appendWorkflowEvent(env, callback, `model:${stepIndex}`, chunks);
  });
  return {
    ...state,
    hasVisibleText: state.hasVisibleText || text.length > 0,
    input: model.input,
    messages: [...state.messages, ...model.step.responseMessages],
    selectedLogicalModelId: model.logicalModelId,
  };
}

async function publishToolStep(
  env: AgentRunWorkflowEnv,
  workflowStep: WorkflowStep,
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
  state: WorkflowAgentState,
  result: WorkflowToolStepResult,
  stepIndex: number,
  toolIndex: number,
  toolStepIndex: number,
): Promise<WorkflowAgentState> {
  const payloadBase = {
    args: result.toolCall.input,
    toolCallId: result.toolCall.toolCallId,
    toolName: result.toolCall.toolName,
  };
  const report = canonicalResearchReport(result);
  const chunks: UIMessageChunk[] = result.error
    ? agentToolErrorUiChunks({ ...payloadBase, error: result.error })
    : agentToolResultUiChunks({ ...payloadBase, result: result.output });
  if (report) {
    const id = `research-report-${stepIndex}-${toolIndex}`;
    chunks.push(
      { id, type: "text-start" },
      { delta: report, id, type: "text-delta" },
      { id, type: "text-end" },
    );
  }
  await workflowStep.do(`publish tool ${stepIndex}.${toolIndex}`, STATE_STEP, async () => {
    emitToolCompletion(env, payload, result, toolStepIndex);
    await appendWorkflowEvent(
      env,
      workflowCallback(payload, workflowInstanceId),
      `tool:${stepIndex}:${toolIndex}`,
      chunks,
    );
  });
  return {
    ...state,
    hasArtifact: state.hasArtifact || chunks.some((chunk) => chunk.type === "data-artifact"),
    hasVisibleText: state.hasVisibleText || report !== undefined,
    input: result.input,
  };
}

function emitToolCompletion(
  env: AgentRunWorkflowEnv,
  payload: AgentRunWorkflowPayload,
  result: WorkflowToolStepResult,
  stepIdx: number,
): void {
  const resultBytes = serializedBytes(result.error ?? result.output ?? null);
  const event = {
    durationMs: result.durationMs,
    resultBytes,
    runId: payload.input.runId,
    stepIdx,
    toolName: result.toolCall.toolName,
    userId: payload.input.userId,
  } as const;
  emitUserEvent(env, { ...event, eventName: "tool_invoked" });
  emitUserEvent(env, { ...event, eventName: "step_completed", stepType: "tool" });
  if (result.toolCall.toolName === "skill_invoke" && !result.error) {
    emitUserEvent(env, {
      durationMs: result.durationMs,
      eventName: "skill_invoked",
      ...skillNameEventFields(result),
      runId: payload.input.runId,
      userId: payload.input.userId,
    });
  }
}

function skillNameEventFields(result: WorkflowToolStepResult): { skillName?: string } {
  const input = asRecord(result.toolCall.input);
  const output = asRecord(result.output);
  const skillName = stringField(input, "skillName") || stringField(output, "name");
  return skillName ? { skillName } : {};
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

async function publishClosingBackstopIfNeeded(
  env: AgentRunWorkflowEnv,
  workflowStep: WorkflowStep,
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
  state: WorkflowAgentState,
): Promise<void> {
  if (state.hasVisibleText) return;
  const text = state.hasArtifact
    ? "Done — your file is ready to download from the deliverables above. Let me know if you'd like any changes."
    : "Done — I've finished the work; you can review it in the Computer panel. Let me know if you'd like any changes.";
  const chunks: UIMessageChunk[] = [
    { id: "answer-closing", type: "text-start" },
    { delta: text, id: "answer-closing", type: "text-delta" },
    { id: "answer-closing", type: "text-end" },
  ];
  await workflowStep.do("publish closing response", STATE_STEP, () =>
    appendWorkflowEvent(
      env,
      workflowCallback(payload, workflowInstanceId),
      "answer:closing",
      chunks,
    ),
  );
}

function toolResultMessage(results: WorkflowToolStepResult[]): ModelMessage {
  return {
    content: results.map((result) => ({
      output: toolModelOutput(result),
      toolCallId: result.toolCall.toolCallId,
      toolName: result.toolCall.toolName,
      type: "tool-result" as const,
    })),
    role: "tool",
  };
}

function toolModelOutput(result: WorkflowToolStepResult): ToolResultPart["output"] {
  if (result.error) return { type: "error-text", value: result.error };
  if (typeof result.output === "string") return { type: "text", value: result.output };
  return { type: "json", value: JsonValueSchema.parse(result.output ?? null) };
}

function serializeWorkflowValue(value: unknown): string {
  return JSON.stringify(workflowJsonValue(value));
}

function workflowJsonValue(value: unknown): z.infer<typeof JsonValueSchema> {
  return JsonValueSchema.parse(JSON.parse(JSON.stringify(value ?? null)));
}

async function completeAgentRun(
  env: AgentRunWorkflowEnv,
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
): Promise<void> {
  await requireCurrent(
    await agentRunStub(env, payload.input.runId).completeWorkflow(
      workflowCallback(payload, workflowInstanceId),
    ),
    "complete AgentRun Workflow",
    true,
  );
}

async function failAgentRun(
  env: AgentRunWorkflowEnv,
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
  failure: ReturnType<typeof toAgentRunStreamError>,
): Promise<void> {
  const response = await agentRunStub(env, payload.input.runId).failWorkflow({
    code: failure.code,
    inputHash: payload.inputHash,
    message: failure.message,
    retriable: failure.retriable,
    workflowInstanceId,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`AgentRun failure persistence returned HTTP ${response.status}.`);
  }
  await response.body?.cancel().catch(() => undefined);
}

async function appendWorkflowEvent(
  env: AgentRunWorkflowEnv,
  callback: AgentRunWorkflowCallbackInput,
  eventKey: string,
  chunks: UIMessageChunk[],
): Promise<void> {
  if (chunks.length === 0) return;
  const input: AgentRunWorkflowEventInput = { ...callback, chunks, eventKey };
  await requireCurrent(
    await agentRunStub(env, callback.input.runId).appendWorkflowEvent(input),
    "append AgentRun Workflow event",
  );
}

async function reuseAgentRunWorkflow(
  workflow: Workflow<AgentRunWorkflowPayload>,
  id: string,
  createError: unknown,
): Promise<string> {
  try {
    const instance = await workflow.get(id);
    const { status } = await instance.status();
    if (status === "unknown") throw createError;
    return instance.id;
  } catch {
    throw createError;
  }
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

async function requireCurrent(
  response: Response,
  operation: string,
  allowTerminal = false,
): Promise<void> {
  if (!response.ok) {
    const detail = await readBoundedResponseText(
      response,
      AGENT_RUN_WORKFLOW_MAX_RESPONSE_BYTES,
      operation,
    );
    throw new Error(`${operation} returned HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const body = AgentRunWorkflowCallbackResponseSchema.parse(
    await readBoundedResponseJson(response, AGENT_RUN_WORKFLOW_MAX_RESPONSE_BYTES, operation),
  );
  if (body.outcome !== "current" && !(allowTerminal && body.outcome === "terminal")) {
    throw new NonRetryableError(`${operation} found a terminal run.`, "AgentRunTerminalError");
  }
}

function workflowCallback(
  payload: AgentRunWorkflowPayload,
  workflowInstanceId: string,
): AgentRunWorkflowCallbackInput {
  return { ...payload, workflowInstanceId };
}

function agentRunStub(env: AgentRunWorkflowEnv, runId: string): DurableObjectStub<AgentRun> {
  return env.AGENT_RUN.get(env.AGENT_RUN.idFromName(runId));
}

function stepConfig(timeout: `${number} ${"minute" | "minutes"}`, retries: number) {
  return {
    retries: { backoff: "exponential" as const, delay: "5 seconds" as const, limit: retries },
    timeout,
  } as const;
}
