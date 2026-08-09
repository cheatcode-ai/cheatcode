import { shellQuote } from "../sandbox-support";
import type { ProjectLocalRuntime } from "./project-sandbox-package-runtime";

const LOCAL_SOURCE_SYNC_BINARY = "/opt/cheatcode/project-source-sync.py";

function runtimeStatePaths(runtime: ProjectLocalRuntime): {
  baselinePath: string;
  busyPath: string;
  lockPath: string;
} {
  return {
    baselinePath: `${runtime.runtimeDir}/package-operation-baseline.json`,
    busyPath: `${runtime.runtimeDir}/preview-sync.busy`,
    lockPath: `${runtime.runtimeDir}/package-operation.lock`,
  };
}

export function localSourceSyncCommand(
  runtime: ProjectLocalRuntime,
  mode: "package-abort" | "package-commit" | "package-prepare" | "preview-loop" | "preview-once",
): string {
  const { baselinePath, busyPath, lockPath } = runtimeStatePaths(runtime);
  return [
    LOCAL_SOURCE_SYNC_BINARY,
    mode,
    runtime.workspaceDir,
    runtime.localSourceDir,
    lockPath,
    busyPath,
    baselinePath,
  ]
    .map(shellQuote)
    .join(" ");
}

/** Runs a long-lived package script on native disk while durable source changes keep flowing in. */
export function localProjectProcessCommand(
  runtime: ProjectLocalRuntime,
  rawCommand: string,
): string {
  const syncOnce = localSourceSyncCommand(runtime, "preview-once");
  const syncLoop = localSourceSyncCommand(runtime, "preview-loop");
  return [
    `${syncOnce} || exit $?`,
    `${syncLoop} &`,
    "sync_pid=$!",
    `cd ${shellQuote(runtime.localCwd)} || exit $?`,
    `${rawCommand} &`,
    "app_pid=$!",
    'terminate() { kill -TERM "$app_pid" "$sync_pid" 2>/dev/null || true; }',
    "trap terminate HUP INT TERM",
    'wait "$app_pid"',
    "status=$?",
    'kill "$sync_pid" 2>/dev/null || true',
    'wait "$sync_pid" 2>/dev/null || true',
    'exit "$status"',
  ].join("\n");
}
