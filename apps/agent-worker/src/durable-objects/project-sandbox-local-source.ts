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

function localSourceSyncCommand(
  runtime: ProjectLocalRuntime,
  mode: "preview-loop" | "preview-once",
): string {
  const { lockPath } = runtimeStatePaths(runtime);
  return [LOCAL_SOURCE_SYNC_BINARY, mode, runtime.workspaceDir, runtime.localSourceDir, lockPath]
    .map(shellQuote)
    .join(" ");
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
