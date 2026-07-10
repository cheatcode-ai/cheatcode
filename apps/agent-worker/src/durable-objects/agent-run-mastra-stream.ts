import { type ApprovalBroker, createCodeRequestContext, mastra } from "@cheatcode/agent-core";
import type { createLogger } from "@cheatcode/observability";
import type { ArtifactRuntime, CodeRuntimeContext } from "@cheatcode/tools-code";
import { stepCountIs } from "ai";
import { resolveWithAbortTimeout } from "./abort-timeout";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";
import { resolveUserSkillContext } from "./agent-run-user-skills";
import { readMastraChunk } from "./agent-run-utils";
import { resolveAgentToolCredentials } from "./agent-tool-credentials";
import type { LlmCredential } from "./llm-provider";

const AGENT_LOOP_MAX_STEPS = 50;
const MASTRA_FIRST_CHUNK_TIMEOUT_MS = 45_000;

type ProjectSandboxStub = CodeRuntimeContext["sandbox"];
type MastraOpenedStream = { fullStream: AsyncIterable<unknown> };

export type MastraStreamOptions = {
  abortSignal: AbortSignal;
  agentContextNote?: string;
  appendCheckedMastraChunk: (input: StartRunInput, chunk: unknown) => Promise<number>;
  approvalBroker: ApprovalBroker | undefined;
  artifactRuntime: ArtifactRuntime;
  env: AgentRunEnv;
  hasPendingDecision: () => boolean;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  runRunCodeFallback: () => Promise<void>;
  sandbox: ProjectSandboxStub;
  setRunStage: (stage: string) => void;
  credential: LlmCredential;
};

export async function runMastraStream(options: MastraStreamOptions): Promise<void> {
  const { credential, env, input, logger, sandbox, setRunStage } = options;
  const toolCredentials = await resolveAgentToolCredentials({
    env,
    logger,
    run: input,
    setRunStage,
  });
  const { userSkills, userSkillStore } = await resolveUserSkillContext(env, input.userId);
  logger.info("agent_tool_credentials_resolved", {
    composioConfigured: Boolean(toolCredentials.composioApiKey),
    exaConfigured: Boolean(toolCredentials.exaApiKey),
    firecrawlConfigured: Boolean(toolCredentials.firecrawlApiKey),
  });
  const { abortController, cleanupAbortListener } = linkedAbortController(options.abortSignal);
  setRunStage("Opening Mastra stream.");
  logger.info("mastra_stream_opening", {
    modelId: credential.modelId,
    provider: credential.provider,
    timeoutMs: MASTRA_FIRST_CHUNK_TIMEOUT_MS,
  });
  try {
    const stream = await resolveWithAbortTimeout({
      abortController,
      operation: mastra.getAgent("general").stream(mastraPromptText(options), {
        abortSignal: abortController.signal,
        maxSteps: AGENT_LOOP_MAX_STEPS,
        requestContext: createCodeRequestContext(
          {
            artifacts: options.artifactRuntime,
            sandbox,
            workspaceDir: `/workspace/${input.workspaceSlug}`,
          },
          {
            agentDisplayName: input.agentDisplayName,
            anthropicApiKey: credential.provider === "anthropic" ? credential.apiKey : undefined,
            approvalBroker: options.approvalBroker,
            composioApiKey: toolCredentials.composioApiKey,
            composioConnectedAccounts: toolCredentials.composioConnectedAccounts,
            composioQuotaMeter: toolCredentials.composioQuotaMeter,
            composioUserId: toolCredentials.composioUserId,
            deepseekApiKey: credential.provider === "deepseek" ? credential.apiKey : undefined,
            exaApiKey: toolCredentials.exaApiKey,
            firecrawlApiKey: toolCredentials.firecrawlApiKey,
            globalMemory: input.globalMemory,
            googleApiKey: credential.provider === "google" ? credential.apiKey : undefined,
            llmProvider: credential.provider,
            masterInstructions: input.masterInstructions,
            modelId: credential.modelId,
            openaiApiKey: credential.provider === "openai" ? credential.apiKey : undefined,
            openrouterApiKey: credential.provider === "openrouter" ? credential.apiKey : undefined,
            projectMode: input.projectMode,
            researchFanoutSubagentLimit: input.researchFanoutSubagentLimit,
            taskMessage: input.messageText,
            userSkills,
            userSkillStore,
          },
        ),
        // DeepSeek V4 defaults to thinking mode; disable it so tool-calling stays a clean
        // OpenAI-style loop (avoids the reasoning_content round-trip). No-op for other providers.
        ...(credential.provider === "deepseek"
          ? { providerOptions: { deepseek: { thinking: { type: "disabled" } } } }
          : {}),
        stopWhen: stepCountIs(AGENT_LOOP_MAX_STEPS),
      }),
      timeoutMs: MASTRA_FIRST_CHUNK_TIMEOUT_MS,
    });
    if (stream === "timeout") {
      if (!options.abortSignal.aborted) {
        logger.warn("mastra_stream_open_timeout", { timeoutMs: MASTRA_FIRST_CHUNK_TIMEOUT_MS });
        await options.runRunCodeFallback();
      }
      return;
    }
    await consumeOpenedMastraStream({
      abortController,
      appendCheckedMastraChunk: options.appendCheckedMastraChunk,
      abortSignal: options.abortSignal,
      credential,
      hasPendingDecision: options.hasPendingDecision,
      input,
      logger,
      runRunCodeFallback: options.runRunCodeFallback,
      setRunStage,
      stream,
    });
  } finally {
    cleanupAbortListener();
  }
}

// Appends an ephemeral agent-context note (e.g. the GitHub-import inspect/start
// instruction) to the prompt handed to Mastra only. The persisted user message,
// written at run create, is untouched, so the UI never shows the note.
function mastraPromptText(options: MastraStreamOptions): string {
  const note = options.agentContextNote;
  return note ? `${options.input.messageText}\n\n${note}` : options.input.messageText;
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

async function consumeOpenedMastraStream(options: {
  abortController: AbortController;
  abortSignal: AbortSignal;
  appendCheckedMastraChunk: (input: StartRunInput, chunk: unknown) => Promise<number>;
  credential: LlmCredential;
  hasPendingDecision: () => boolean;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  runRunCodeFallback: () => Promise<void>;
  setRunStage: (stage: string) => void;
  stream: MastraOpenedStream;
}): Promise<void> {
  options.logger.info("mastra_stream_opened", {
    modelId: options.credential.modelId,
    provider: options.credential.provider,
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
    await runFallbackUnlessCanceled(options);
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
    await runFallbackUnlessCanceled(options);
    return;
  }
  if (streamResult === "timeout-after-visible") {
    await iterator.return?.();
  }
}

async function runFallbackUnlessCanceled(options: {
  abortSignal: AbortSignal;
  runRunCodeFallback: () => Promise<void>;
}): Promise<void> {
  if (!options.abortSignal.aborted) {
    await options.runRunCodeFallback();
  }
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
      ? MASTRA_FIRST_CHUNK_TIMEOUT_MS
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
