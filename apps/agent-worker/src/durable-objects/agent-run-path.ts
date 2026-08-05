import type { createLogger } from "@cheatcode/observability";
import type { CodeRuntimeContext, WorkspaceResolver } from "@cheatcode/sandbox-contracts";
import type { UIMessageChunk } from "ai";
import { restartMobilePreview, runAppBuilder, warmSandbox } from "./agent-run-app-builder";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";

type ProjectSandboxStub = CodeRuntimeContext["sandbox"];

export interface AppBuilderRunOptions {
  abortSignal: AbortSignal;
  append: (chunk: UIMessageChunk) => Promise<void>;
  env: AgentRunEnv;
  input: StartRunInput;
  isCanceled: () => boolean;
  logger: ReturnType<typeof createLogger>;
  sandbox: ProjectSandboxStub;
  setRunStage: (stage: string) => Promise<void>;
  workspaceResolver: WorkspaceResolver;
}

type ProjectBoundStartRunInput = StartRunInput & {
  projectId: string;
  workspaceSlug: string;
};

type ProjectBoundAppBuilderRunOptions = AppBuilderRunOptions & {
  input: ProjectBoundStartRunInput;
};

export interface PreparedAppBuilderRun {
  agentContextNote?: string;
  options: ProjectBoundAppBuilderRunOptions;
  waitsForGeneratedPreview: boolean;
}

export async function prepareAppBuilderRun(
  options: AppBuilderRunOptions,
): Promise<PreparedAppBuilderRun | null> {
  const appBuilderMode = appBuilderModeForRun(options.input);
  if (!appBuilderMode) return null;
  options.input.projectMode = appBuilderMode;
  await options.workspaceResolver();
  const boundOptions = { ...options, input: requireProjectBinding(options.input) };
  await warmSandbox(boundOptions.sandbox, boundOptions.logger);
  if (boundOptions.isCanceled()) {
    return { options: boundOptions, waitsForGeneratedPreview: false };
  }
  const prepared = await runAppBuilder(boundOptions);
  return { ...prepared, options: boundOptions };
}

export async function finalizeAppBuilderRun(prepared: {
  options: AppBuilderRunOptions;
  waitsForGeneratedPreview: boolean;
}): Promise<void> {
  const options = { ...prepared.options, input: requireProjectBinding(prepared.options.input) };
  await restartMobilePreviewIfNeeded(options);
  if (prepared.waitsForGeneratedPreview) {
    await options.append({
      type: "data-app-preview-status",
      data: { v: 1, status: "ready" },
    });
  }
}

async function restartMobilePreviewIfNeeded(
  options: ProjectBoundAppBuilderRunOptions,
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

function isAppBuilderMode(
  mode: StartRunInput["projectMode"],
): mode is "app-builder" | "app-builder-mobile" {
  return mode === "app-builder" || mode === "app-builder-mobile";
}

const IMPERATIVE_BUILD_PATTERN =
  /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:build|create|make|design|develop|implement|code|scaffold|redesign|clone)\b/iu;
const MOBILE_APP_PATTERN = /\b(?:mobile app|expo|react native|ios app|android app|iphone app)\b/iu;
const WEB_APP_PATTERN =
  /\b(?:web ?app|website|web ?site|landing ?page|home ?page|web ?page|dashboard|next\.?js|frontend|front-end|saas)\b/iu;

function appBuilderModeForRun(input: StartRunInput): "app-builder" | "app-builder-mobile" | null {
  if (isAppBuilderMode(input.projectMode)) {
    return input.projectMode;
  }
  if (input.projectId || !IMPERATIVE_BUILD_PATTERN.test(input.messageText)) {
    return null;
  }
  if (MOBILE_APP_PATTERN.test(input.messageText)) {
    return "app-builder-mobile";
  }
  return WEB_APP_PATTERN.test(input.messageText) ? "app-builder" : null;
}
