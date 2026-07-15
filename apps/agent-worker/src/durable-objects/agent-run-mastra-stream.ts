import { type ApprovalBroker, createCodeRequestContext, mastra } from "@cheatcode/agent-core";
import { workspacePathForSlug } from "@cheatcode/db";
import { APIError, type createLogger } from "@cheatcode/observability";
import type { ArtifactRuntime, CodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import { isLoopFinished, type ModelMessage } from "ai";
import { resolveWithAbortTimeout } from "./abort-timeout";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";
import { resolveUserSkillContext } from "./agent-run-user-skills";
import { readMastraChunk } from "./agent-run-utils";
import { resolveAgentToolCredentials } from "./agent-tool-credentials";
import type { LlmCredential } from "./llm-provider";

const MASTRA_FIRST_CHUNK_TIMEOUT_MS = 45_000;
const MASTRA_PROGRESS_TIMEOUT_MS = 11 * 60_000;

type ProjectSandboxStub = CodeRuntimeContext["sandbox"];
type MastraOpenedStream = { fullStream: AsyncIterable<unknown> };
type ResolvedToolCredentials = Awaited<ReturnType<typeof resolveAgentToolCredentials>>;
type ResolvedUserSkillContext = Awaited<ReturnType<typeof resolveUserSkillContext>>;

interface PreparedMastraContext extends ResolvedUserSkillContext {
  toolCredentials: ResolvedToolCredentials;
}

interface ConsumeMastraStreamOptions {
  abortController: AbortController;
  abortSignal: AbortSignal;
  appendCheckedMastraChunk: (input: StartRunInput, chunk: unknown) => Promise<number>;
  credential: LlmCredential;
  hasPendingDecision: () => boolean;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  setRunStage: (stage: string) => void;
  stream: MastraOpenedStream;
}

export type MastraStreamOptions = {
  abortSignal: AbortSignal;
  appendCheckedMastraChunk: (input: StartRunInput, chunk: unknown) => Promise<number>;
  approvalBroker: ApprovalBroker | undefined;
  artifactRuntime: ArtifactRuntime;
  env: AgentRunEnv;
  hasPendingDecision: () => boolean;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  modelMessages: ModelMessage[];
  sandbox: ProjectSandboxStub;
  setRunStage: (stage: string) => void;
  credential: LlmCredential;
};

export async function runMastraStream(options: MastraStreamOptions): Promise<void> {
  const prepared = await prepareMastraContext(options);
  const { abortController, cleanupAbortListener } = linkedAbortController(options.abortSignal);
  options.setRunStage("Opening Mastra stream.");
  options.logger.info("mastra_stream_opening", {
    logicalModelId: options.credential.logicalModelId,
    timeoutMs: MASTRA_FIRST_CHUNK_TIMEOUT_MS,
    transportModelId: options.credential.transportModelId,
    transportProvider: options.credential.transportProvider,
  });
  try {
    const stream = await openMastraStream(options, prepared, abortController);
    if (stream === "timeout") {
      if (!options.abortSignal.aborted) {
        options.logger.warn("mastra_stream_open_timeout", {
          timeoutMs: MASTRA_FIRST_CHUNK_TIMEOUT_MS,
        });
        throw modelStreamTimeoutError();
      }
      return;
    }
    await consumeOpenedMastraStream({
      abortController,
      appendCheckedMastraChunk: options.appendCheckedMastraChunk,
      abortSignal: options.abortSignal,
      credential: options.credential,
      hasPendingDecision: options.hasPendingDecision,
      input: options.input,
      logger: options.logger,
      setRunStage: options.setRunStage,
      stream,
    });
  } finally {
    cleanupAbortListener();
  }
}

async function prepareMastraContext(options: MastraStreamOptions): Promise<PreparedMastraContext> {
  const toolCredentials = await resolveAgentToolCredentials({
    env: options.env,
    logger: options.logger,
    run: options.input,
    setRunStage: options.setRunStage,
  });
  const userSkillContext = await resolveUserSkillContext(options.env, options.input.userId);
  options.logger.info("agent_tool_credentials_resolved", {
    composioConfigured: Boolean(toolCredentials.composioApiKey),
    exaConfigured: Boolean(toolCredentials.exaApiKey),
    firecrawlConfigured: Boolean(toolCredentials.firecrawlApiKey),
  });
  return { ...userSkillContext, toolCredentials };
}

async function openMastraStream(
  options: MastraStreamOptions,
  prepared: PreparedMastraContext,
  abortController: AbortController,
): Promise<MastraOpenedStream | "timeout"> {
  return resolveWithAbortTimeout({
    abortController,
    operation: mastra.getAgent("general").stream(options.modelMessages, {
      abortSignal: abortController.signal,
      requestContext: agentRequestContext(options, prepared),
      runId: options.input.runId,
      ...(options.credential.transportProvider === "deepseek"
        ? { providerOptions: { deepseek: { thinking: { type: "disabled" } } } }
        : {}),
      stopWhen: isLoopFinished(),
    }),
    timeoutMs: MASTRA_FIRST_CHUNK_TIMEOUT_MS,
  });
}

function agentRequestContext(
  options: MastraStreamOptions,
  prepared: PreparedMastraContext,
): ReturnType<typeof createCodeRequestContext> {
  const { credential, input } = options;
  const { toolCredentials, userSkillLoader, userSkills, userSkillStore } = prepared;
  return createCodeRequestContext(
    {
      artifacts: options.artifactRuntime,
      sandbox: options.sandbox,
      workspaceDir: workspacePathForSlug(input.workspaceSlug),
    },
    {
      agentDisplayName: input.agentDisplayName,
      anthropicApiKey: credential.transportProvider === "anthropic" ? credential.apiKey : undefined,
      approvalBroker: options.approvalBroker,
      composioApiKey: toolCredentials.composioApiKey,
      composioConnectedAccounts: toolCredentials.composioConnectedAccounts,
      composioQuotaMeter: toolCredentials.composioQuotaMeter,
      composioUserId: toolCredentials.composioUserId,
      deepseekApiKey: credential.transportProvider === "deepseek" ? credential.apiKey : undefined,
      exaApiKey: toolCredentials.exaApiKey,
      firecrawlApiKey: toolCredentials.firecrawlApiKey,
      globalMemory: input.globalMemory,
      googleApiKey: credential.transportProvider === "google" ? credential.apiKey : undefined,
      llmProvider: credential.transportProvider,
      masterInstructions: input.masterInstructions,
      modelId: credential.transportModelId,
      openaiApiKey: credential.transportProvider === "openai" ? credential.apiKey : undefined,
      openrouterApiKey:
        credential.transportProvider === "openrouter" ? credential.apiKey : undefined,
      projectMode: input.projectMode,
      runId: input.runId,
      taskMessage: input.messageText,
      userSkillLoader,
      userSkills,
      userSkillStore,
    },
  );
}

function linkedAbortController(runAbortSignal: AbortSignal): {
  abortController: AbortController;
  cleanupAbortListener: () => void;
} {
  const abortController = new AbortController();
  const abortFromRun = () => abortController.abort(new Error("run canceled"));
  if (runAbortSignal.aborted) {
    abortFromRun();
    return { abortController, cleanupAbortListener: () => undefined };
  }
  runAbortSignal.addEventListener("abort", abortFromRun, { once: true });
  return {
    abortController,
    cleanupAbortListener: () => runAbortSignal.removeEventListener("abort", abortFromRun),
  };
}

async function consumeOpenedMastraStream(options: ConsumeMastraStreamOptions): Promise<void> {
  options.logger.info("mastra_stream_opened", {
    logicalModelId: options.credential.logicalModelId,
    transportModelId: options.credential.transportModelId,
    transportProvider: options.credential.transportProvider,
  });
  options.setRunStage("Streaming model response.");
  const iterator = options.stream.fullStream[Symbol.asyncIterator]();
  const firstChunk = await readMastraChunk(
    iterator,
    MASTRA_FIRST_CHUNK_TIMEOUT_MS,
    options.abortController,
    options.hasPendingDecision,
  );
  if (firstChunk === "timeout") {
    await iterator.return?.();
    if (!options.abortSignal.aborted) {
      throw modelStreamTimeoutError();
    }
    return;
  }
  const streamResult = await appendMastraStreamChunks({
    abortController: options.abortController,
    appendCheckedMastraChunk: options.appendCheckedMastraChunk,
    firstChunk,
    hasPendingDecision: options.hasPendingDecision,
    input: options.input,
    iterator,
  });
  if (streamResult === "timeout-before-visible") {
    await iterator.return?.();
    if (!options.abortSignal.aborted) {
      throw modelStreamTimeoutError();
    }
    return;
  }
  if (streamResult === "timeout-after-visible") {
    await iterator.return?.();
    if (!options.abortSignal.aborted) {
      throw modelStreamTimeoutError();
    }
  }
}

function modelStreamTimeoutError(): APIError {
  return new APIError(504, "upstream_timeout_llm", "The model stream timed out.", {
    hint: "Retry the run. If the timeout persists, choose another configured model.",
    retriable: true,
  });
}

async function appendMastraStreamChunks(options: {
  abortController: AbortController;
  appendCheckedMastraChunk: (input: StartRunInput, chunk: unknown) => Promise<number>;
  firstChunk: IteratorResult<unknown, unknown>;
  hasPendingDecision: () => boolean;
  input: StartRunInput;
  iterator: AsyncIterator<unknown>;
}): Promise<"completed" | "timeout-after-visible" | "timeout-before-visible"> {
  let hasVisibleChunk = false;
  const firstVisibleChunkDeadline = Date.now() + MASTRA_FIRST_CHUNK_TIMEOUT_MS;
  if (options.firstChunk.done) {
    return "completed";
  }
  hasVisibleChunk =
    (await options.appendCheckedMastraChunk(options.input, options.firstChunk.value)) > 0;
  for (;;) {
    const timeoutMs = hasVisibleChunk
      ? MASTRA_PROGRESS_TIMEOUT_MS
      : Math.max(1, firstVisibleChunkDeadline - Date.now());
    const nextChunk = await readMastraChunk(
      options.iterator,
      timeoutMs,
      options.abortController,
      options.hasPendingDecision,
    );
    if (nextChunk === "timeout") {
      return hasVisibleChunk ? "timeout-after-visible" : "timeout-before-visible";
    }
    if (nextChunk.done) {
      return "completed";
    }
    const appendedCount = await options.appendCheckedMastraChunk(options.input, nextChunk.value);
    hasVisibleChunk = appendedCount > 0 || hasVisibleChunk;
  }
}
