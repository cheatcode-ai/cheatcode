import { mastra } from "@cheatcode/agent-core";
import { createLogger } from "@cheatcode/observability";
import type { UIMessageChunk } from "ai";
import type { AgentRunEnv } from "./agent-run-env";
import { toAgentRunStreamError } from "./agent-run-errors";
import { persistOrQueueAssistantMessage } from "./agent-run-message-persistence";
import type { AgentRunOutput } from "./agent-run-output";
import { runPlanChunk, runTaskStatusChunk } from "./agent-run-progress";
import type { StartRunInput } from "./agent-run-schemas";
import type { PersistableRunStatus } from "./agent-run-status-persistence";
import type { ProjectSandbox } from "./project-sandbox";

const BROWSER_DRIVER_PROCESS_PREFIX = "cheatcode-browser-driver-";
const RUN_LEASE_RENEW_INTERVAL_MS = 4 * 60 * 1_000;

type ProjectSandboxStub = DurableObjectStub<ProjectSandbox>;
type RunPathResult = "completed" | "continue";
type TerminalRunStatus = "canceled" | "completed" | "failed";

export interface AgentRunLifecycleDeps {
  append: (chunk: UIMessageChunk) => Promise<void>;
  ctx: DurableObjectState;
  env: AgentRunEnv;
  executeRunPath: (
    input: StartRunInput,
    sandbox: ProjectSandboxStub,
    logger: ReturnType<typeof createLogger>,
    abortSignal: AbortSignal,
  ) => Promise<RunPathResult>;
  finalizeTerminal: (status: TerminalRunStatus, operation: () => Promise<void>) => Promise<boolean>;
  isCanceled: () => boolean;
  output: AgentRunOutput;
  persistRunStatus: (
    input: StartRunInput,
    status: PersistableRunStatus,
    error?: { message: string; type: string },
  ) => Promise<void>;
  setRunStage: (stage: string) => void;
}

interface RunExecution {
  abortController: AbortController;
  deps: AgentRunLifecycleDeps;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  runLeaseHeartbeat?: ReturnType<typeof setInterval>;
  runLeaseOpened: boolean;
  sandbox: ProjectSandboxStub;
}

/** Owns one run's progress, terminal persistence, and sandbox lease lifecycle. */
export async function executeAgentRunLifecycle(
  deps: AgentRunLifecycleDeps,
  input: StartRunInput,
  abortController: AbortController,
): Promise<void> {
  const execution = createRunExecution(deps, input, abortController);
  logRunStarted(execution);
  deps.output.resetAnswerState();
  try {
    await executeActiveRun(execution);
  } catch (error) {
    await failRun(execution, error);
  } finally {
    await cleanupRun(execution);
  }
}

function createRunExecution(
  deps: AgentRunLifecycleDeps,
  input: StartRunInput,
  abortController: AbortController,
): RunExecution {
  return {
    abortController,
    deps,
    input,
    logger: createLogger({ threadId: input.threadId, userId: input.userId }),
    runLeaseOpened: false,
    sandbox: deps.env.PROJECT_SANDBOX.get(deps.env.PROJECT_SANDBOX.idFromName(input.sandboxName)),
  };
}

async function executeActiveRun(execution: RunExecution): Promise<void> {
  const { deps, input } = execution;
  await deps.persistRunStatus(input, "running");
  await deps.append({ type: "start" });
  await deps.append(runPlanChunk());
  await deps.append({ type: "data-sandbox-status", data: { v: 1, status: "starting" } });
  deps.setRunStage("Preparing project sandbox.");
  await openRunLease(execution);
  if (deps.isCanceled()) {
    return;
  }
  await deps.append(runTaskStatusChunk("prepare-sandbox", "completed"));
  await deps.append(runTaskStatusChunk("run-agent", "running"));
  const path = await deps.executeRunPath(
    input,
    execution.sandbox,
    execution.logger,
    execution.abortController.signal,
  );
  if (path !== "completed" && !deps.isCanceled()) {
    await completeRun(execution);
  }
}

async function openRunLease(execution: RunExecution): Promise<void> {
  await execution.sandbox.beginRun(execution.input.runId);
  execution.runLeaseOpened = true;
  execution.runLeaseHeartbeat = setInterval(() => {
    void renewRunLease(execution);
  }, RUN_LEASE_RENEW_INTERVAL_MS);
}

async function renewRunLease(execution: RunExecution): Promise<void> {
  try {
    await execution.sandbox.renewRun(execution.input.runId);
  } catch (error) {
    execution.logger.warn("sandbox_run_lease_renewal_failed", {
      error,
    });
  }
}

async function completeRun(execution: RunExecution): Promise<void> {
  const { deps, input } = execution;
  await deps.finalizeTerminal("completed", async () => {
    await deps.append(runTaskStatusChunk("run-agent", "completed"));
    await deps.append(runTaskStatusChunk("stream-results", "running"));
    await deps.append({ type: "data-sandbox-status", data: { v: 1, status: "ready" } });
    await deps.append(runTaskStatusChunk("stream-results", "completed"));
    await deps.output.appendClosingBackstop();
    await deps.output.ensureAnswerSegmentEnded();
    await deps.append({ type: "finish", finishReason: "stop" });
    await persistAssistantMessage(execution);
    await deps.persistRunStatus(input, "completed");
  });
}

async function failRun(execution: RunExecution, error: unknown): Promise<void> {
  const { deps, input, logger } = execution;
  if (deps.isCanceled()) {
    return;
  }
  await deps.finalizeTerminal("failed", async () => {
    const streamError = toAgentRunStreamError(error);
    logger.error("agent_run_failed", {
      code: streamError.code,
      error,
      retriable: streamError.retriable,
    });
    await deps.append({ type: "data-sandbox-status", data: { v: 1, status: "failed" } });
    await deps.append(runTaskStatusChunk("run-agent", "failed", streamError.message));
    await deps.append(runTaskStatusChunk("stream-results", "failed", streamError.message));
    await deps.append({
      type: "data-error",
      data: {
        v: 1,
        code: streamError.code,
        message: streamError.message,
        retriable: streamError.retriable,
      },
    });
    await deps.output.ensureAnswerSegmentEnded();
    await deps.append({ type: "finish", finishReason: "error" });
    await persistAssistantMessage(execution);
    await deps.persistRunStatus(input, "failed", {
      message: streamError.message,
      type: streamError.code,
    });
  });
}

async function persistAssistantMessage(execution: RunExecution): Promise<void> {
  await persistOrQueueAssistantMessage({
    ctx: execution.deps.ctx,
    env: execution.deps.env,
    logger: execution.logger,
    runId: execution.input.runId,
    threadId: execution.input.threadId,
    userId: execution.input.userId,
  });
}

async function cleanupRun(execution: RunExecution): Promise<void> {
  if (execution.runLeaseHeartbeat !== undefined) {
    clearInterval(execution.runLeaseHeartbeat);
  }
  if (execution.sandbox.killProcess) {
    await execution.sandbox
      .killProcess({ processId: browserDriverProcessId(execution.input.runId) })
      .catch((error: unknown) => {
        execution.logger.warn("browser_driver_cleanup_failed", {
          error,
        });
      });
  }
  if (execution.runLeaseOpened) {
    await execution.sandbox.endRun(execution.input.runId).catch(() => undefined);
  }
}

function logRunStarted(execution: RunExecution): void {
  execution.logger.info("agent_run_started", {
    mastra_agent_ready: Boolean(mastra.getAgent("general")),
  });
}

function browserDriverProcessId(runId: string): string {
  const safeRunId = runId.replaceAll(/[^A-Za-z0-9_-]/g, "-").slice(0, 120);
  return `${BROWSER_DRIVER_PROCESS_PREFIX}${safeRunId}`;
}
