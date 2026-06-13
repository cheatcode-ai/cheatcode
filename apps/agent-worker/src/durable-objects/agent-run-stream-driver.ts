import type { ApprovalBroker } from "@cheatcode/agent-core";
import type { createLogger } from "@cheatcode/observability";
import type { ArtifactRuntime, CodeRuntimeContext } from "@cheatcode/tools-code";
import { FALLBACK_MODEL_ID } from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import { offerModelFallback } from "./agent-run-approvals";
import type { AgentRunEnv } from "./agent-run-env";
import { runMastraStream } from "./agent-run-mastra-stream";
import { runRunCodeFallback as runRunCodeFallbackTool } from "./agent-run-run-code-fallback";
import type { StartRunInput } from "./agent-run-schemas";
import {
  classifyFallbackReason,
  type LlmCredential,
  resolveLlmCredential,
  resolveOpenAiFallbackCredential,
  shouldFallbackToOpenAI,
} from "./llm-provider";

type ProjectSandboxStub = CodeRuntimeContext["sandbox"];

/** Thin DO closures the stream driver needs (run-control §5.3 / §5.4). */
export interface StreamDriverDeps {
  append: (chunk: UIMessageChunk) => Promise<void>;
  appendCheckedMastraChunk: (input: StartRunInput, chunk: unknown) => Promise<number>;
  createArtifactRuntime: (input: StartRunInput) => ArtifactRuntime;
  createBroker: () => ApprovalBroker;
  env: AgentRunEnv;
  hasPendingDecision: () => boolean;
  setRunStage: (stage: string) => void;
}

interface StreamRunParams {
  abortSignal: AbortSignal;
  agentContextNote?: string;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  sandbox: ProjectSandboxStub;
}

/**
 * Runs the Mastra stream against the primary BYOK provider, falling back to the
 * OpenAI default through the interactive consent flow (run-control §5.5) on a
 * provider rate-limit/credit failure.
 */
export async function streamMastraRunWithFallback(
  deps: StreamDriverDeps,
  params: StreamRunParams,
): Promise<void> {
  deps.setRunStage("Resolving BYOK credentials.");
  const primaryCredential = await resolveLlmCredential(deps.env, params.input, params.logger);
  try {
    await streamMastraRun(deps, params, primaryCredential);
  } catch (error) {
    await handleFallback(deps, params, primaryCredential, error);
  }
}

async function handleFallback(
  deps: StreamDriverDeps,
  params: StreamRunParams,
  primaryCredential: LlmCredential,
  error: unknown,
): Promise<void> {
  if (!shouldFallbackToOpenAI(params.input.model, primaryCredential, error)) {
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
  const decision = await offerModelFallback({
    append: deps.append,
    broker: deps.createBroker(),
    fromModel: primaryCredential.modelId,
    reason: classifyFallbackReason(error),
    toModel: fallbackCredential.modelId,
  });
  if (decision.decision === "deny") {
    throw error;
  }
  params.logger.warn("llm_provider_fallback_started", {
    from: primaryCredential.provider,
    to: fallbackCredential.provider,
  });
  await streamMastraRun(deps, params, fallbackCredential);
}

async function streamMastraRun(
  deps: StreamDriverDeps,
  params: StreamRunParams,
  credential: LlmCredential,
): Promise<void> {
  await runMastraStream({
    abortSignal: params.abortSignal,
    ...(params.agentContextNote === undefined ? {} : { agentContextNote: params.agentContextNote }),
    appendCheckedMastraChunk: deps.appendCheckedMastraChunk,
    approvalBroker: deps.createBroker(),
    artifactRuntime: deps.createArtifactRuntime(params.input),
    credential,
    env: deps.env,
    hasPendingDecision: deps.hasPendingDecision,
    input: params.input,
    logger: params.logger,
    runRunCodeFallback: () =>
      runRunCodeFallbackTool({
        append: deps.append,
        input: params.input,
        logger: params.logger,
        sandbox: params.sandbox,
        setRunStage: deps.setRunStage,
      }),
    sandbox: params.sandbox,
    setRunStage: deps.setRunStage,
  });
}
