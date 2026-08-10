import { shellQuote } from "../sandbox-support";
import type { ProjectLocalRuntime } from "./project-sandbox-package-runtime";

const LOCAL_SOURCE_SYNC_BINARY = "/opt/cheatcode/project-source-sync.py";

function runtimeStatePaths(runtime: ProjectLocalRuntime): {
  lockPath: string;
} {
  return {
    lockPath: `${runtime.runtimeDir}/package-operation.lock`,
  };
}

/** Runs pnpm and commits its source changes while holding one crash-safe OS lock. */
export function localPackageCommand(
  runtime: ProjectLocalRuntime,
  command: readonly string[],
): string {
  const { lockPath } = runtimeStatePaths(runtime);
  return [
    LOCAL_SOURCE_SYNC_BINARY,
    "package-run",
    runtime.workspaceDir,
    runtime.localSourceDir,
    lockPath,
    runtime.localCwd,
    "--",
    ...command,
  ]
    .map(shellQuote)
    .join(" ");
}

/** Runs a long-lived project process on native disk while durable source changes keep flowing in. */
export function localProjectProcessCommand(
  runtime: ProjectLocalRuntime,
  command: readonly string[],
  dependencyTemplateDir?: string,
): string[] {
  const { lockPath } = runtimeStatePaths(runtime);
  return [
    LOCAL_SOURCE_SYNC_BINARY,
    "preview-run",
    runtime.workspaceDir,
    runtime.localSourceDir,
    lockPath,
    runtime.localCwd,
    dependencyTemplateDir ?? "-",
    "--",
    ...command,
  ];
}
