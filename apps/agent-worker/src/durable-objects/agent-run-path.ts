import type { createLogger } from "@cheatcode/observability";
import type { CodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import type { UIMessageChunk } from "ai";
import { restartMobilePreview, runAppBuilder, warmSandbox } from "./agent-run-app-builder";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";
import { type StreamDriverDeps, streamMastraRunWithFallback } from "./agent-run-stream-driver";

type ProjectSandboxStub = CodeRuntimeContext["sandbox"];

export interface AgentRunPathOptions {
  abortSignal: AbortSignal;
  append: (chunk: UIMessageChunk) => Promise<void>;
  env: AgentRunEnv;
  input: StartRunInput;
  isCanceled: () => boolean;
  logger: ReturnType<typeof createLogger>;
  sandbox: ProjectSandboxStub;
  setRunStage: (stage: string) => void;
  streamDriverDeps: StreamDriverDeps;
}

export async function executeAgentRunPath(
  options: AgentRunPathOptions,
): Promise<"completed" | "continue"> {
  await ensureProjectWorkspaceDir(options);
  if (isAppBuilderMode(options.input.projectMode)) {
    return executeAppBuilderPath(options);
  }
  await streamMastraRunWithFallback(options.streamDriverDeps, options);
  return options.isCanceled() ? "completed" : "continue";
}

async function ensureProjectWorkspaceDir(options: AgentRunPathOptions): Promise<void> {
  if (!options.sandbox.exec) {
    return;
  }
  try {
    await options.sandbox.exec({
      command: ["mkdir", "-p", `/workspace/${options.input.workspaceSlug}`],
      timeoutMs: 15_000,
    });
  } catch (error) {
    options.logger.warn("workspace_dir_ensure_failed", {
      error,
      workspaceSlug: options.input.workspaceSlug,
    });
  }
}

async function executeAppBuilderPath(
  options: AgentRunPathOptions,
): Promise<"completed" | "continue"> {
  await warmSandbox(options.sandbox, options.logger);
  if (options.isCanceled()) {
    return "completed";
  }
  const { agentContextNote } = await runAppBuilder(options);
  if (options.isCanceled()) {
    return "completed";
  }
  await streamMastraRunWithFallback(options.streamDriverDeps, {
    abortSignal: options.abortSignal,
    ...(agentContextNote === undefined ? {} : { agentContextNote }),
    input: options.input,
    logger: options.logger,
    sandbox: options.sandbox,
  });
  if (options.isCanceled()) {
    return "completed";
  }
  await restartMobilePreviewIfNeeded(options);
  return "continue";
}

async function restartMobilePreviewIfNeeded(options: AgentRunPathOptions): Promise<void> {
  if (options.input.projectMode !== "app-builder-mobile") {
    return;
  }
  try {
    await restartMobilePreview(options);
  } catch (error) {
    options.logger.warn("mobile_preview_restart_failed", {
      error,
    });
  }
}

function isAppBuilderMode(mode: StartRunInput["projectMode"]): boolean {
  return mode === "app-builder" || mode === "app-builder-mobile";
}
