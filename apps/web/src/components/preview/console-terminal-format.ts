import type { SandboxTerminalResult } from "@cheatcode/types/api";
import { DEFAULT_TERMINAL_CWD } from "@/components/preview/console-terminal-state";
import type { ConsoleSeverity } from "@/lib/preview/console";

export function severityClass(severity: ConsoleSeverity): string {
  if (severity === "error") {
    return "text-danger-fg";
  }
  if (severity === "warn") {
    return "text-brand-accent-fg";
  }
  return "text-fg-tertiary";
}

export function terminalOutput(result: SandboxTerminalResult): string {
  return [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join("\n");
}

export function promptText(
  cwd: string,
  terminalHost: string,
  displayWorkspacePath: string,
): string {
  return `root@${terminalHost}:${displayTerminalCwd(cwd, displayWorkspacePath)}#`;
}

function displayTerminalCwd(cwd: string, displayWorkspacePath: string): string {
  if (cwd === DEFAULT_TERMINAL_CWD) {
    return displayWorkspacePath;
  }
  if (cwd.startsWith(`${DEFAULT_TERMINAL_CWD}/`)) {
    return `${displayWorkspacePath}/${cwd.slice(DEFAULT_TERMINAL_CWD.length + 1)}`;
  }
  return cwd;
}
