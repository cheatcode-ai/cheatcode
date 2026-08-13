import type { createLogger } from "@cheatcode/observability";
import type { CodeRuntimeContext, WorkspaceResolver } from "@cheatcode/sandbox-contracts";
import type { UIMessageChunk } from "ai";
import { runAppBuilder } from "./agent-run-app-builder";
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
  usesManagedPreview: boolean;
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
  if (boundOptions.isCanceled()) {
    return { options: boundOptions, usesManagedPreview: false, waitsForGeneratedPreview: false };
  }
  const prepared = await runAppBuilder(boundOptions);
  return { ...prepared, options: boundOptions };
}

export async function finalizeAppBuilderRun(prepared: {
  options: AppBuilderRunOptions;
  waitsForGeneratedPreview: boolean;
}): Promise<void> {
  const options = { ...prepared.options, input: requireProjectBinding(prepared.options.input) };
  if (prepared.waitsForGeneratedPreview) {
    await options.append({
      type: "data-app-preview-status",
      data: { v: 1, status: "ready" },
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
const GENERIC_APP_PATTERN = /\b(?:app|application)\b/iu;
const NON_WEB_APP_PATTERN =
  /\b(?:api|backend|cli|command[ -]line|desktop|electron|library|macos|server|terminal|windows)\b/iu;

function appBuilderModeForRun(input: StartRunInput): "app-builder" | "app-builder-mobile" | null {
  if (isAppBuilderMode(input.projectMode)) {
    return input.projectMode;
  }
  // A composer surface is an explicit outcome choice. Do not reinterpret words inside that
  // artifact request as an instruction to build an app (for example, a memo about a website).
  if (input.runIntent) {
    return null;
  }
  if (input.projectId || !IMPERATIVE_BUILD_PATTERN.test(input.messageText)) {
    return null;
  }
  if (MOBILE_APP_PATTERN.test(input.messageText)) {
    return "app-builder-mobile";
  }
  if (WEB_APP_PATTERN.test(input.messageText)) {
    return "app-builder";
  }
  return GENERIC_APP_PATTERN.test(input.messageText) && !NON_WEB_APP_PATTERN.test(input.messageText)
    ? "app-builder"
    : null;
}
