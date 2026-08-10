import {
  executeGeneralAgentTool,
  GeneralAgentFinishReasonSchema,
  type GeneralAgentToolCall,
  generateGeneralAgentStep,
} from "@cheatcode/agent-core";
import {
  createLogger,
  emitErrorEvent,
  readBoundedResponseJson,
  safeErrorTelemetry,
} from "@cheatcode/observability";
import type { ArtifactRuntime, WorkspaceResolver } from "@cheatcode/sandbox-contracts";
import {
  FALLBACK_MODEL_ID,
  type LogicalModelId,
  LogicalModelIdSchema,
  toAgentRunId,
  toProjectId,
  toThreadId,
  toUserId,
} from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import { z } from "zod";
import type { AgentRun } from "./agent-run";
import { storeAgentArtifact } from "./agent-run-artifacts";
import { loadThreadModelContext } from "./agent-run-conversation";
import { restoreReferencedDeliverables } from "./agent-run-deliverables";
import type { AgentRunEnv } from "./agent-run-env";
import { toAgentRunStreamError } from "./agent-run-errors";
import {
  createAgentRequestContext,
  type MastraContextOptions,
  prepareMastraContext,
} from "./agent-run-mastra-context";
import { finalizeAppBuilderRun, prepareAppBuilderRun } from "./agent-run-path";
import { type StartRunInput, StartRunInputSchema } from "./agent-run-schemas";
import { guardSkillRuntimeCapabilities } from "./agent-run-skill-runtime";
import { agentToolErrorText } from "./agent-run-tool-error-support";
import {
  AGENT_RUN_WORKFLOW_MAX_RESPONSE_BYTES,
  type AgentRunWorkflowCallbackInput,
  AgentRunWorkflowCallbackResponseSchema,
  type AgentRunWorkflowEventInput,
  type AgentRunWorkflowPayload,
} from "./agent-run-workflow-protocol";
import { createRunWorkspaceResolver } from "./agent-run-workspace";
import {
  classifyFallbackReason,
  type LlmCredential,
  resolveLlmCredential,
  resolveOpenAiFallbackCredential,
  shouldFallbackToOpenAI,
} from "./llm-provider";
import type { ProjectSandbox } from "./project-sandbox";

const MODEL_STEP_TIMEOUT_MS = 3 * 60_000;
const TOOL_STEP_TIMEOUT_MS = 14 * 60_000;
const BROWSER_DRIVER_PROCESS_PREFIX = "cheatcode-browser-driver-";

type ProjectSandboxStub = DurableObjectStub<ProjectSandbox>;
const WorkflowJsonValueSchema = z.json();
type WorkflowJsonValue = z.infer<typeof WorkflowJsonValueSchema>;

const WorkflowToolCallSchema = z.strictObject({
  input: WorkflowJsonValueSchema,
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
});

export const WorkflowAgentStateSchema = z.strictObject({
  appBuilderWaitsForPreview: z.boolean(),
  hasArtifact: z.boolean(),
  hasVisibleText: z.boolean(),
  input: StartRunInputSchema,
  messages: z.array(WorkflowJsonValueSchema),
  selectedLogicalModelId: LogicalModelIdSchema.optional(),
});

export const WorkflowModelStepResultSchema = z.strictObject({
  fallback: z
    .strictObject({
      fromModel: LogicalModelIdSchema,
      reason: z.enum(["provider_balance", "provider_error", "rate_limit"]),
      toModel: LogicalModelIdSchema,
    })
    .optional(),
  input: StartRunInputSchema,
  logicalModelId: LogicalModelIdSchema,
  step: z.strictObject({
    finishReason: GeneralAgentFinishReasonSchema,
    responseMessages: z.array(WorkflowJsonValueSchema),
    text: z.string(),
    toolCalls: z.array(WorkflowToolCallSchema),
  }),
});

export const WorkflowToolStepResultSchema = z.strictObject({
  durationMs: z.number().int().nonnegative(),
  error: z.string().optional(),
  input: StartRunInputSchema,
  output: WorkflowJsonValueSchema.optional(),
  toolCall: WorkflowToolCallSchema,
});

export type WorkflowAgentState = z.infer<typeof WorkflowAgentStateSchema>;
export type WorkflowModelStepResult = z.infer<typeof WorkflowModelStepResultSchema>;
export type WorkflowToolStepResult = z.infer<typeof WorkflowToolStepResultSchema>;

/** Establishes the sandbox and model context in a retry-safe Workflow step. */
export async function prepareWorkflowAgentRun(
  env: AgentRunEnv & { AGENT_RUN: DurableObjectNamespace<AgentRun> },
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
): Promise<WorkflowAgentState> {
  const callback = workflowCallback(payload, workflowInstanceId);
  const stub = agentRunStub(env, payload.input.runId);
  await requireCurrent(await stub.beginWorkflow(callback), "begin AgentRun Workflow");
  const input = structuredClone(payload.input);
  const logger = createLogger({
    runId: input.runId,
    threadId: input.threadId,
    userId: input.userId,
  });
  const sandbox = sandboxFor(env, input);
  await sandbox.beginRun(input.runId);
  await restoreUploadedFiles(input, sandbox, logger);
  await restoreReferencedDeliverables({ env, input, logger, sandbox });
  const runtime = workflowRuntimeOptions({
    callback,
    env,
    eventPrefix: "prepare",
    input,
    logger,
    sandbox,
    stub,
  });
  const preparedApp = await prepareAppBuilderRun(runtime.pathOptions);
  const threadContext = await loadWorkflowThreadContext(env, input, preparedApp?.agentContextNote);
  return WorkflowAgentStateSchema.parse({
    appBuilderWaitsForPreview: preparedApp?.waitsForGeneratedPreview ?? false,
    hasArtifact: false,
    hasVisibleText: false,
    input,
    messages: threadContext,
  });
}

/** Executes one model turn; no tool implementation runs inside this step. */
export async function generateWorkflowModelStep(
  env: AgentRunEnv & { AGENT_RUN: DurableObjectNamespace<AgentRun> },
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
  state: WorkflowAgentState,
): Promise<WorkflowModelStepResult> {
  const input = structuredClone(state.input);
  const callback = workflowCallback(payload, workflowInstanceId);
  const stub = agentRunStub(env, input.runId);
  const logger = createLogger({
    runId: input.runId,
    threadId: input.threadId,
    userId: input.userId,
  });
  const sandbox = sandboxFor(env, input);
  await sandbox.renewRun(input.runId);
  await stub.waitForBrowserTakeover(callback);
  const primary = await resolveCredentialForState(env, input, state.selectedLogicalModelId, logger);
  try {
    return await generateWithCredential({
      callback,
      env,
      input,
      logger,
      messages: state.messages,
      primary,
      sandbox,
      stub,
    });
  } catch (error) {
    if (!shouldFallbackToOpenAI(input.isModelExplicit, primary, false, error)) throw error;
    if (input.disabledModels.includes(FALLBACK_MODEL_ID)) throw error;
    const fallback = await resolveOpenAiFallbackCredential(env, input, logger);
    if (!fallback) throw error;
    const generated = await generateWithCredential({
      callback,
      env,
      input,
      logger,
      messages: state.messages,
      primary: fallback,
      sandbox,
      stub,
    });
    return {
      ...generated,
      fallback: {
        fromModel: primary.logicalModelId,
        reason: classifyFallbackReason(error),
        toModel: fallback.logicalModelId,
      },
    };
  }
}

/** Executes one checkpointed tool call and returns only serializable state. */
export async function executeWorkflowToolStep(
  env: AgentRunEnv & { AGENT_RUN: DurableObjectNamespace<AgentRun> },
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
  state: WorkflowAgentState,
  toolCall: GeneralAgentToolCall,
): Promise<WorkflowToolStepResult> {
  const input = structuredClone(state.input);
  const callback = workflowCallback(payload, workflowInstanceId);
  const stub = agentRunStub(env, input.runId);
  const logger = createLogger({
    runId: input.runId,
    threadId: input.threadId,
    userId: input.userId,
  });
  const sandbox = sandboxFor(env, input);
  try {
    await sandbox.renewRun(input.runId);
    await stub.waitForBrowserTakeover(callback);
    return await guardSkillRuntimeCapabilities({
      env,
      logger,
      operation: () =>
        executePreparedWorkflowTool({
          callback,
          env,
          input,
          logger,
          sandbox,
          selectedLogicalModelId: state.selectedLogicalModelId,
          stub,
          toolCall,
        }),
      run: input,
      sandbox,
    });
  } catch (error) {
    recordToolStepInfrastructureFailure(env, input, toolCall, error, logger);
    throw error;
  }
}

function recordToolStepInfrastructureFailure(
  env: AgentRunEnv,
  input: StartRunInput,
  toolCall: GeneralAgentToolCall,
  error: unknown,
  logger: ReturnType<typeof createLogger>,
): void {
  const failure = toAgentRunStreamError(error);
  const telemetry = safeErrorTelemetry(error);
  emitErrorEvent(env, {
    errorCategory: "agent_run_tool_step",
    errorCode: failure.code,
    route: "agent-run-workflow/tool-step",
    runId: input.runId,
    userId: input.userId,
    workerName: "agent-worker",
    ...(env.CHEATCODE_RELEASE_SHA ? { versionTag: env.CHEATCODE_RELEASE_SHA } : {}),
    ...telemetry,
  });
  logger.error("agent_run_tool_step_failed", {
    failureCode: failure.code,
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    ...telemetry,
  });
}

async function executePreparedWorkflowTool(input: {
  callback: AgentRunWorkflowCallbackInput;
  env: AgentRunEnv & { AGENT_RUN: DurableObjectNamespace<AgentRun> };
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  sandbox: ProjectSandboxStub;
  selectedLogicalModelId: LogicalModelId | undefined;
  stub: DurableObjectStub<AgentRun>;
  toolCall: GeneralAgentToolCall;
}): Promise<WorkflowToolStepResult> {
  const startedAt = Date.now();
  const credential = await resolveCredentialForState(
    input.env,
    input.input,
    input.selectedLogicalModelId,
    input.logger,
  );
  const runtime = workflowRuntimeOptions({
    callback: input.callback,
    env: input.env,
    eventPrefix: `tool-${input.toolCall.toolCallId.slice(0, 36)}`,
    input: input.input,
    logger: input.logger,
    sandbox: input.sandbox,
    stub: input.stub,
  });
  const prepared = await prepareMastraContext(runtime.mastraOptions(credential));
  const requestContext = createAgentRequestContext(runtime.mastraOptions(credential), prepared);
  try {
    const output = await executeGeneralAgentTool({
      abortSignal: AbortSignal.timeout(TOOL_STEP_TIMEOUT_MS),
      input: input.toolCall.input,
      requestContext,
      runId: input.input.runId,
      toolCallId: input.toolCall.toolCallId,
      toolName: input.toolCall.toolName,
    });
    return WorkflowToolStepResultSchema.parse({
      durationMs: Date.now() - startedAt,
      input: input.input,
      output: jsonValue(output),
      toolCall: input.toolCall,
    });
  } catch (error) {
    return WorkflowToolStepResultSchema.parse({
      durationMs: Date.now() - startedAt,
      error: agentToolErrorText(error),
      input: input.input,
      toolCall: input.toolCall,
    });
  }
}

export async function finalizeWorkflowAppBuilder(
  env: AgentRunEnv & { AGENT_RUN: DurableObjectNamespace<AgentRun> },
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
  state: WorkflowAgentState,
): Promise<void> {
  if (!state.appBuilderWaitsForPreview && state.input.projectMode !== "app-builder-mobile") return;
  const input = structuredClone(state.input);
  const callback = workflowCallback(payload, workflowInstanceId);
  const stub = agentRunStub(env, input.runId);
  const logger = createLogger({
    runId: input.runId,
    threadId: input.threadId,
    userId: input.userId,
  });
  const sandbox = sandboxFor(env, input);
  const runtime = workflowRuntimeOptions({
    callback,
    env,
    eventPrefix: "app-finalize",
    input,
    logger,
    sandbox,
    stub,
  });
  await finalizeAppBuilderRun({
    options: runtime.pathOptions,
    waitsForGeneratedPreview: state.appBuilderWaitsForPreview,
  });
}

export async function cleanupWorkflowAgentRun(
  env: AgentRunEnv & { AGENT_RUN: DurableObjectNamespace<AgentRun> },
  workflowInstanceId: string,
  payload: AgentRunWorkflowPayload,
  input: StartRunInput,
): Promise<void> {
  const callback = workflowCallback(payload, workflowInstanceId);
  const stub = agentRunStub(env, input.runId);
  const sandbox = sandboxFor(env, input);
  if (sandbox.killProcess) {
    await sandbox
      .killProcess({ processId: browserDriverProcessId(input.runId) })
      .catch(() => undefined);
  }
  await restoreUploadedFiles(input, sandbox, createLogger({ runId: input.runId })).catch(
    () => undefined,
  );
  await sandbox.endRun(input.runId).catch(() => undefined);
  const response = await stub.cleanupWorkflow(callback);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`clean up AgentRun Workflow returned HTTP ${response.status}.`);
  }
  await response.body?.cancel().catch(() => undefined);
}

async function generateWithCredential(input: {
  callback: AgentRunWorkflowCallbackInput;
  env: AgentRunEnv & { AGENT_RUN: DurableObjectNamespace<AgentRun> };
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  messages: WorkflowJsonValue[];
  primary: LlmCredential;
  sandbox: ProjectSandboxStub;
  stub: DurableObjectStub<AgentRun>;
}): Promise<WorkflowModelStepResult> {
  const runtime = workflowRuntimeOptions({
    callback: input.callback,
    env: input.env,
    eventPrefix: "model-runtime",
    input: input.input,
    logger: input.logger,
    sandbox: input.sandbox,
    stub: input.stub,
  });
  const options = runtime.mastraOptions(input.primary);
  const prepared = await prepareMastraContext(options);
  const requestContext = createAgentRequestContext(options, prepared);
  const step = await generateGeneralAgentStep({
    abortSignal: AbortSignal.timeout(MODEL_STEP_TIMEOUT_MS),
    ...(input.input.runIntent === "skill-creator"
      ? {
          activeTools: [
            "fs_apply",
            "fs_delete",
            "fs_list",
            "fs_read",
            "fs_search",
            "fs_write",
            "shell_exec",
            "skill_create",
          ],
        }
      : {}),
    isDeepSeek: input.primary.transportProvider === "deepseek",
    messages: input.messages,
    requestContext,
    runId: input.input.runId,
  });
  return WorkflowModelStepResultSchema.parse({
    input: input.input,
    logicalModelId: input.primary.logicalModelId,
    step,
  });
}

function workflowRuntimeOptions(input: {
  callback: AgentRunWorkflowCallbackInput;
  env: AgentRunEnv & { AGENT_RUN: DurableObjectNamespace<AgentRun> };
  eventPrefix: string;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  sandbox: ProjectSandboxStub;
  stub: DurableObjectStub<AgentRun>;
}) {
  const append = async (chunk: UIMessageChunk) => {
    const event: AgentRunWorkflowEventInput = {
      ...input.callback,
      chunks: [chunk],
      eventKey: await workflowEventKey(input.eventPrefix, chunk),
    };
    await requireCurrent(await input.stub.appendWorkflowEvent(event), "append Workflow event");
  };
  const workspaceResolver = createRunWorkspaceResolver({
    append,
    env: input.env,
    input: input.input,
    logger: input.logger,
    sandbox: input.sandbox,
  });
  const artifactRuntime = createArtifactRuntime(input.env, input.input, workspaceResolver);
  const setRunStage = async (stage: string): Promise<void> => {
    await requireCurrent(
      await input.stub.setWorkflowStage({ ...input.callback, stage }),
      "set Workflow stage",
    );
  };
  const pathOptions = {
    abortSignal: AbortSignal.timeout(TOOL_STEP_TIMEOUT_MS),
    append,
    env: input.env,
    input: input.input,
    isCanceled: () => false,
    logger: input.logger,
    sandbox: input.sandbox,
    setRunStage,
    workspaceResolver,
  };
  return {
    pathOptions,
    mastraOptions: (credential: LlmCredential): MastraContextOptions => ({
      artifactRuntime,
      credential,
      env: input.env,
      input: input.input,
      logger: input.logger,
      sandbox: input.sandbox,
      setRunStage,
      workspaceResolver,
    }),
  };
}

async function workflowEventKey(prefix: string, chunk: UIMessageChunk): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(chunk));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${prefix}:${hash}`;
}

function createArtifactRuntime(
  env: AgentRunEnv,
  input: StartRunInput,
  workspaceResolver: WorkspaceResolver,
): ArtifactRuntime {
  return {
    put: async (artifact) => {
      const workspace = await workspaceResolver();
      return storeAgentArtifact({
        artifact,
        env,
        input: {
          projectId: toProjectId(workspace.projectId),
          runId: toAgentRunId(input.runId),
          threadId: toThreadId(input.threadId),
          userId: toUserId(input.userId),
        },
      });
    },
  };
}

async function resolveCredentialForState(
  env: AgentRunEnv,
  input: StartRunInput,
  selected: LogicalModelId | undefined,
  logger: ReturnType<typeof createLogger>,
): Promise<LlmCredential> {
  if (selected === FALLBACK_MODEL_ID) {
    const fallback = await resolveOpenAiFallbackCredential(env, input, logger);
    if (fallback) return fallback;
  }
  return resolveLlmCredential(env, input, logger);
}

async function loadWorkflowThreadContext(
  env: AgentRunEnv,
  input: StartRunInput,
  agentContextNote: string | undefined,
): Promise<WorkflowJsonValue[]> {
  const loaded = await loadThreadModelContext(env, input, agentContextNote);
  return loaded.messages.map(toJsonValue);
}

async function restoreUploadedFiles(
  input: StartRunInput,
  sandbox: ProjectSandboxStub,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  if (!input.projectId || !input.workspaceSlug) return;
  const result = await sandbox.restoreUploadedFiles({
    projectId: input.projectId,
    workspaceSlug: input.workspaceSlug,
  });
  if (result.restoredFileCount > 0) {
    logger.info("project_uploads_restored", {
      projectId: input.projectId,
      restoredFileCount: result.restoredFileCount,
    });
  }
}

function sandboxFor(env: AgentRunEnv, input: StartRunInput): ProjectSandboxStub {
  return env.PROJECT_SANDBOX.get(env.PROJECT_SANDBOX.idFromName(input.sandboxName));
}

function agentRunStub(
  env: AgentRunEnv & { AGENT_RUN: DurableObjectNamespace<AgentRun> },
  runId: string,
): DurableObjectStub<AgentRun> {
  return env.AGENT_RUN.get(env.AGENT_RUN.idFromName(runId));
}

function workflowCallback(
  payload: AgentRunWorkflowPayload,
  workflowInstanceId: string,
): AgentRunWorkflowCallbackInput {
  return { ...payload, workflowInstanceId };
}

async function requireCurrent(response: Response, operation: string): Promise<void> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${operation} returned HTTP ${response.status}.`);
  }
  const body = AgentRunWorkflowCallbackResponseSchema.parse(
    await readBoundedResponseJson(response, AGENT_RUN_WORKFLOW_MAX_RESPONSE_BYTES, operation),
  );
  if (body.outcome !== "current") {
    throw new Error(`${operation} found a terminal AgentRun.`);
  }
}

function browserDriverProcessId(runId: string): string {
  const safeRunId = runId.replaceAll(/[^A-Za-z0-9_-]/g, "-").slice(0, 120);
  return `${BROWSER_DRIVER_PROCESS_PREFIX}${safeRunId}`;
}

function jsonValue(value: unknown): WorkflowJsonValue {
  return toJsonValue(value ?? null);
}

function toJsonValue(value: unknown): WorkflowJsonValue {
  return WorkflowJsonValueSchema.parse(JSON.parse(JSON.stringify(value ?? null)));
}
