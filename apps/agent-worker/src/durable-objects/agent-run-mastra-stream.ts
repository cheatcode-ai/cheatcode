import { type AgentChunkType, createCodeRequestContext, mastra } from "@cheatcode/agent-core";
import { workspacePathForSlug } from "@cheatcode/db";
import { APIError, type createLogger } from "@cheatcode/observability";
import type {
  ArtifactRuntime,
  CodeRuntimeContext,
  WorkspaceResolver,
} from "@cheatcode/sandbox-contracts";
import { hasToolCall, type ModelMessage, stepCountIs } from "ai";
import { resolveWithAbortTimeout } from "./abort-timeout";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";
import { projectSkillRuntimeConfig } from "./agent-run-skill-runtime";
import { resolveUserSkillContext } from "./agent-run-user-skills";
import { readMastraChunk } from "./agent-run-utils";
import { resolveAgentToolCredentials } from "./agent-tool-credentials";
import type { LlmCredential } from "./llm-provider";

const MASTRA_FIRST_CHUNK_TIMEOUT_MS = 45_000;
const MASTRA_VISIBLE_INACTIVITY_TIMEOUT_MS = 3 * 60_000;
const MASTRA_TOOL_HEARTBEAT_TIMEOUT_MS = 11 * 60_000;
const MASTRA_RUN_DEADLINE_MS = 60 * 60_000;

type ProjectSandboxStub = CodeRuntimeContext["sandbox"];
type MastraOpenedStream = { fullStream: AsyncIterable<AgentChunkType> };
type ResolvedToolCredentials = Awaited<ReturnType<typeof resolveAgentToolCredentials>>;
type ResolvedUserSkillContext = Awaited<ReturnType<typeof resolveUserSkillContext>>;

interface PreparedMastraContext extends ResolvedUserSkillContext {
  toolCredentials: ResolvedToolCredentials;
}

interface ConsumeMastraStreamOptions {
  abortController: AbortController;
  abortSignal: AbortSignal;
  appendCheckedMastraChunk: (input: StartRunInput, chunk: AgentChunkType) => Promise<number>;
  credential: LlmCredential;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  setRunStage: (stage: string) => void;
  stream: MastraOpenedStream;
  waitForBrowserTakeover: (signal: AbortSignal) => Promise<number>;
}

export type MastraStreamOptions = {
  abortSignal: AbortSignal;
  appendCheckedMastraChunk: (input: StartRunInput, chunk: AgentChunkType) => Promise<number>;
  artifactRuntime: ArtifactRuntime;
  env: AgentRunEnv;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  modelMessages: ModelMessage[];
  sandbox: ProjectSandboxStub;
  setRunStage: (stage: string) => void;
  workspaceResolver: WorkspaceResolver;
  waitForBrowserTakeover: (signal: AbortSignal) => Promise<number>;
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
      input: options.input,
      logger: options.logger,
      setRunStage: options.setRunStage,
      stream,
      waitForBrowserTakeover: options.waitForBrowserTakeover,
    });
  } finally {
    cleanupAbortListener();
  }
}

async function prepareMastraContext(options: MastraStreamOptions): Promise<PreparedMastraContext> {
  await projectSkillRuntimeConfig({
    env: options.env,
    run: options.input,
    sandbox: options.sandbox,
  });
  const toolCredentials = await resolveAgentToolCredentials({
    env: options.env,
    logger: options.logger,
    run: options.input,
    setRunStage: options.setRunStage,
  });
  const userSkillContext = await resolveUserSkillContext(
    options.env,
    options.input.userId,
    options.sandbox,
  );
  options.logger.info("agent_tool_credentials_resolved", {
    composioConfigured: Boolean(toolCredentials.composioApiKey),
    exaConfigured: Boolean(toolCredentials.exaApiKey),
    firecrawlConfigured: Boolean(toolCredentials.firecrawlApiKey),
    googleMediaConfigured: Boolean(toolCredentials.googleMediaApiKey),
  });
  return { ...userSkillContext, toolCredentials };
}

async function openMastraStream(
  options: MastraStreamOptions,
  prepared: PreparedMastraContext,
  abortController: AbortController,
): Promise<MastraOpenedStream | "timeout"> {
  const opened = await resolveWithAbortTimeout({
    abortController,
    operation: mastra.getAgent("general").stream(options.modelMessages, {
      abortSignal: abortController.signal,
      requestContext: agentRequestContext(options, prepared),
      runId: options.input.runId,
      ...(options.credential.transportProvider === "deepseek"
        ? { providerOptions: { deepseek: { thinking: { type: "disabled" } } } }
        : {}),
      ...executionPolicy(options.input.runIntent),
    }),
    timeoutMs: MASTRA_FIRST_CHUNK_TIMEOUT_MS,
  });
  if (opened === "timeout") {
    return opened;
  }
  // Mastra shares a broad ChunkType declaration across agent/workflow outputs; getAgent().stream()
  // emits the AgentChunkType branch, which is the only contract accepted past this adapter.
  return { fullStream: opened.fullStream as AsyncIterable<AgentChunkType> };
}

function executionPolicy(runIntent: StartRunInput["runIntent"]) {
  if (runIntent !== "skill-creator") {
    return { stopWhen: stepCountIs(50) };
  }
  const skillAuthoringTools = [
    "fs_delete",
    "fs_list",
    "fs_read",
    "fs_search",
    "fs_write",
    "shell_exec",
    "skill_create",
  ];
  return {
    activeTools: skillAuthoringTools,
    stopWhen: [hasToolCall("skill_create"), stepCountIs(30)],
  };
}

function agentRequestContext(
  options: MastraStreamOptions,
  prepared: PreparedMastraContext,
): ReturnType<typeof createCodeRequestContext> {
  const { credential, input } = options;
  const { toolCredentials, userSkillCreator, userSkillLoader, userSkills } = prepared;
  const isSkillCreator = input.runIntent === "skill-creator";
  const codeRuntime: CodeRuntimeContext = {
    artifacts: options.artifactRuntime,
    ensureWorkspace: async () => {
      const workspace = await options.workspaceResolver();
      codeRuntime.workspaceDir = workspace.workspaceDir;
      return workspace;
    },
    sandbox: options.sandbox,
    ...(isSkillCreator
      ? { workspaceDir: "/workspace" }
      : input.workspaceSlug
        ? { workspaceDir: workspacePathForSlug(input.workspaceSlug) }
        : {}),
  };
  return createCodeRequestContext(codeRuntime, {
    agentDisplayName: input.agentDisplayName,
    anthropicApiKey: credential.transportProvider === "anthropic" ? credential.apiKey : undefined,
    composioApiKey: toolCredentials.composioApiKey,
    composioConnectedAccounts: toolCredentials.composioConnectedAccounts,
    composioQuotaMeter: toolCredentials.composioQuotaMeter,
    composioUserId: toolCredentials.composioUserId,
    deepseekApiKey: credential.transportProvider === "deepseek" ? credential.apiKey : undefined,
    exaApiKey: toolCredentials.exaApiKey,
    firecrawlApiKey: toolCredentials.firecrawlApiKey,
    globalMemory: input.globalMemory,
    googleApiKey:
      credential.transportProvider === "google"
        ? credential.apiKey
        : toolCredentials.googleMediaApiKey,
    llmProvider: credential.transportProvider,
    modelId: credential.transportModelId,
    openaiApiKey: credential.transportProvider === "openai" ? credential.apiKey : undefined,
    openrouterApiKey: credential.transportProvider === "openrouter" ? credential.apiKey : undefined,
    projectMode: input.projectMode,
    runIntent: input.runIntent,
    runId: input.runId,
    taskMessage: input.messageText,
    ...(isSkillCreator ? { userSkillCreator } : {}),
    userSkillLoader,
    userSkills,
  });
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
  await options.waitForBrowserTakeover(options.abortSignal);
  const firstChunk = await readMastraChunk(
    iterator,
    MASTRA_FIRST_CHUNK_TIMEOUT_MS,
    options.abortController,
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
    input: options.input,
    iterator,
    waitForBrowserTakeover: options.waitForBrowserTakeover,
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
  appendCheckedMastraChunk: (input: StartRunInput, chunk: AgentChunkType) => Promise<number>;
  firstChunk: IteratorResult<AgentChunkType, unknown>;
  input: StartRunInput;
  iterator: AsyncIterator<AgentChunkType>;
  waitForBrowserTakeover: (signal: AbortSignal) => Promise<number>;
}): Promise<"completed" | "timeout-after-visible" | "timeout-before-visible"> {
  let hasVisibleChunk = false;
  let activityDeadline = Date.now() + MASTRA_FIRST_CHUNK_TIMEOUT_MS;
  let runDeadline = Date.now() + MASTRA_RUN_DEADLINE_MS;
  const pendingToolCalls = new Set<string>();
  if (options.firstChunk.done) {
    return "completed";
  }
  ({ activityDeadline, runDeadline } = await extendDeadlinesForTakeover(
    options,
    activityDeadline,
    runDeadline,
  ));
  updatePendingToolCalls(pendingToolCalls, options.firstChunk.value);
  hasVisibleChunk =
    (await options.appendCheckedMastraChunk(options.input, options.firstChunk.value)) > 0;
  activityDeadline = nextActivityDeadline(hasVisibleChunk, pendingToolCalls.size > 0);
  for (;;) {
    ({ activityDeadline, runDeadline } = await extendDeadlinesForTakeover(
      options,
      activityDeadline,
      runDeadline,
    ));
    const timeoutMs = Math.max(1, Math.min(activityDeadline, runDeadline) - Date.now());
    const nextChunk = await readMastraChunk(options.iterator, timeoutMs, options.abortController);
    if (nextChunk === "timeout") {
      return hasVisibleChunk ? "timeout-after-visible" : "timeout-before-visible";
    }
    if (nextChunk.done) {
      return "completed";
    }
    ({ activityDeadline, runDeadline } = await extendDeadlinesForTakeover(
      options,
      activityDeadline,
      runDeadline,
    ));
    updatePendingToolCalls(pendingToolCalls, nextChunk.value);
    const appendedCount = await options.appendCheckedMastraChunk(options.input, nextChunk.value);
    hasVisibleChunk = appendedCount > 0 || hasVisibleChunk;
    if (appendedCount > 0 || pendingToolCalls.size > 0) {
      activityDeadline = nextActivityDeadline(hasVisibleChunk, pendingToolCalls.size > 0);
    }
  }
}

async function extendDeadlinesForTakeover(
  options: {
    abortController: AbortController;
    waitForBrowserTakeover: (signal: AbortSignal) => Promise<number>;
  },
  activityDeadline: number,
  runDeadline: number,
): Promise<{ activityDeadline: number; runDeadline: number }> {
  const pausedMs = await options.waitForBrowserTakeover(options.abortController.signal);
  return {
    activityDeadline: activityDeadline + pausedMs,
    runDeadline: runDeadline + pausedMs,
  };
}

function nextActivityDeadline(hasVisibleChunk: boolean, hasPendingTool: boolean): number {
  if (hasPendingTool) {
    return Date.now() + MASTRA_TOOL_HEARTBEAT_TIMEOUT_MS;
  }
  return (
    Date.now() +
    (hasVisibleChunk ? MASTRA_VISIBLE_INACTIVITY_TIMEOUT_MS : MASTRA_FIRST_CHUNK_TIMEOUT_MS)
  );
}

function updatePendingToolCalls(pendingToolCalls: Set<string>, chunk: AgentChunkType): void {
  if (chunk.type === "tool-call") {
    pendingToolCalls.add(chunk.payload.toolCallId);
    return;
  }
  if (chunk.type === "tool-result" || chunk.type === "tool-error") {
    pendingToolCalls.delete(chunk.payload.toolCallId);
  }
}
