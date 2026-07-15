import type { ApprovalBroker } from "@cheatcode/agent-core";
import { type createLogger, emitUserEvent } from "@cheatcode/observability";
import type { ArtifactRuntime, CodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import { FALLBACK_MODEL_ID, type LogicalModelId } from "@cheatcode/types";
import type { ModelMessage, UIMessageChunk } from "ai";
import { appendModelFallbackTransition, offerModelFallback } from "./agent-run-approvals";
import { loadThreadModelContext } from "./agent-run-conversation";
import type { AgentRunEnv } from "./agent-run-env";
import { runMastraStream } from "./agent-run-mastra-stream";
import type { StartRunInput } from "./agent-run-schemas";
import {
  classifyFallbackReason,
  type LlmCredential,
  resolveLlmCredential,
  resolveOpenAiFallbackCredential,
  shouldFallbackToOpenAI,
} from "./llm-provider";

type ProjectSandboxStub = CodeRuntimeContext["sandbox"];

/** Thin DO closures the stream driver needs. */
export interface StreamDriverDeps {
  append: (chunk: UIMessageChunk) => Promise<void>;
  appendCheckedMastraChunk: (input: StartRunInput, chunk: unknown) => Promise<number>;
  createArtifactRuntime: (input: StartRunInput) => ArtifactRuntime;
  createBroker: () => ApprovalBroker;
  env: AgentRunEnv;
  hasPendingDecision: () => boolean;
  persistLogicalModel: (
    input: StartRunInput,
    logicalModelId: LogicalModelId,
    logger: ReturnType<typeof createLogger>,
  ) => Promise<void>;
  setRunStage: (stage: string) => void;
}

interface StreamRunParams {
  abortSignal: AbortSignal;
  agentContextNote?: string;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  sandbox: ProjectSandboxStub;
}

type PreparedStreamRunParams = StreamRunParams & { modelMessages: ModelMessage[] };

interface StreamAttemptState {
  hasVisibleOutput: boolean;
}

/**
 * Runs the Mastra stream against the primary BYOK provider, falling back to the
 * OpenAI default through the interactive consent flow on a provider
 * rate-limit or provider-balance failure.
 */
export async function streamMastraRunWithFallback(
  deps: StreamDriverDeps,
  params: StreamRunParams,
): Promise<void> {
  deps.setRunStage("Resolving BYOK credentials.");
  const [primaryCredential, threadContext] = await Promise.all([
    resolveLlmCredential(deps.env, params.input, params.logger),
    loadThreadModelContext(deps.env, params.input, params.agentContextNote),
  ]);
  params.logger.info("agent_thread_context_loaded", {
    messageCount: threadContext.persistedMessageCount,
    serializedBytes: threadContext.serializedBytes,
  });
  const preparedParams = { ...params, modelMessages: threadContext.messages };
  const attemptState: StreamAttemptState = { hasVisibleOutput: false };
  try {
    await streamMastraRun(deps, preparedParams, primaryCredential, attemptState);
  } catch (error) {
    await handleFallback(
      deps,
      preparedParams,
      primaryCredential,
      attemptState.hasVisibleOutput,
      error,
    );
  }
}

async function handleFallback(
  deps: StreamDriverDeps,
  params: PreparedStreamRunParams,
  primaryCredential: LlmCredential,
  hasVisibleOutput: boolean,
  error: unknown,
): Promise<void> {
  if (
    !shouldFallbackToOpenAI(params.input.modelExplicit, primaryCredential, hasVisibleOutput, error)
  ) {
    throw error;
  }
  if (params.input.disabledModels.includes(FALLBACK_MODEL_ID)) {
    params.logger.warn("llm_fallback_suppressed_by_user", { fallbackModel: FALLBACK_MODEL_ID });
    throw error;
  }
  const fallbackCredential = await resolveOpenAiFallbackCredential(
    deps.env,
    params.input,
    params.logger,
  );
  if (!fallbackCredential) {
    throw error;
  }
  const fallbackReason = classifyFallbackReason(error);
  const decision = await offerModelFallback({
    broker: deps.createBroker(),
    fromModel: primaryCredential.logicalModelId,
    reason: fallbackReason,
    toModel: fallbackCredential.logicalModelId,
  });
  if (decision.decision === "deny") {
    throw error;
  }
  params.logger.warn("llm_provider_fallback_started", {
    fromLogicalModelId: primaryCredential.logicalModelId,
    fromTransportProvider: primaryCredential.transportProvider,
    toLogicalModelId: fallbackCredential.logicalModelId,
    toTransportProvider: fallbackCredential.transportProvider,
  });
  await streamMastraRun(deps, params, fallbackCredential, { hasVisibleOutput: false }, () =>
    appendModelFallbackTransition({
      append: deps.append,
      fromModel: primaryCredential.logicalModelId,
      reason: fallbackReason,
      toModel: fallbackCredential.logicalModelId,
    }),
  );
}

async function streamMastraRun(
  deps: StreamDriverDeps,
  params: PreparedStreamRunParams,
  credential: LlmCredential,
  attemptState: StreamAttemptState,
  afterModelPersisted?: () => Promise<void>,
): Promise<void> {
  await deps.persistLogicalModel(params.input, credential.logicalModelId, params.logger);
  await afterModelPersisted?.();
  emitUserEvent(deps.env, {
    eventName: "run_model_resolved",
    logicalModelId: credential.logicalModelId,
    runId: params.input.runId,
    userId: params.input.userId,
  });
  params.logger.info("llm_stream_attempt_started", {
    logicalModelId: credential.logicalModelId,
    transportModelId: credential.transportModelId,
    transportProvider: credential.transportProvider,
  });
  await runMastraStream({
    abortSignal: params.abortSignal,
    appendCheckedMastraChunk: async (input, chunk) => {
      const appendedCount = await deps.appendCheckedMastraChunk(input, chunk);
      attemptState.hasVisibleOutput = attemptState.hasVisibleOutput || appendedCount > 0;
      return appendedCount;
    },
    approvalBroker: deps.createBroker(),
    artifactRuntime: deps.createArtifactRuntime(params.input),
    credential,
    env: deps.env,
    hasPendingDecision: deps.hasPendingDecision,
    input: params.input,
    logger: params.logger,
    modelMessages: params.modelMessages,
    sandbox: params.sandbox,
    setRunStage: deps.setRunStage,
  });
}
