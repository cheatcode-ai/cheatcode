import type { createLogger } from "@cheatcode/observability";
import type { CodeRuntimeContext, WorkspaceResolver } from "@cheatcode/sandbox-contracts";
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
  workspaceResolver: WorkspaceResolver;
}

type ProjectBoundStartRunInput = StartRunInput & {
  projectId: string;
  workspaceSlug: string;
};

type ProjectBoundAgentRunPathOptions = AgentRunPathOptions & {
  input: ProjectBoundStartRunInput;
};

export async function executeAgentRunPath(
  options: AgentRunPathOptions,
): Promise<"completed" | "continue"> {
  if (isAppBuilderMode(options.input.projectMode)) {
    await options.workspaceResolver();
    return executeAppBuilderPath({
      ...options,
      input: requireProjectBinding(options.input),
    });
  }
  await streamMastraRunWithFallback(options.streamDriverDeps, options);
  return options.isCanceled() ? "completed" : "continue";
}

async function executeAppBuilderPath(
  options: ProjectBoundAgentRunPathOptions,
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
    workspaceResolver: options.workspaceResolver,
  });
  if (options.isCanceled()) {
    return "completed";
  }
  await restartMobilePreviewIfNeeded(options);
  return "continue";
}

async function restartMobilePreviewIfNeeded(
  options: ProjectBoundAgentRunPathOptions,
): Promise<void> {
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

function requireProjectBinding(input: StartRunInput): ProjectBoundStartRunInput {
  if (!input.projectId || !input.workspaceSlug) {
    throw new Error("Workspace resolver completed without a project binding.");
  }
  return input as ProjectBoundStartRunInput;
}

function isAppBuilderMode(mode: StartRunInput["projectMode"]): boolean {
  return mode === "app-builder" || mode === "app-builder-mobile";
}
