import { APIError } from "@cheatcode/observability";

const MAX_TOOL_ERROR_CHARACTERS = 8_000;
const MAX_TOOL_ERROR_OUTPUT_CHARACTERS = 3_000;
const SANDBOX_DIAGNOSTIC_CODES = new Set([
  "sandbox_command_failed",
  "sandbox_start_failed",
  "upstream_sandbox_timeout",
]);

/** Preserves bounded, user-scoped execution diagnostics for the model's next turn. */
export function agentToolErrorText(error: unknown): string {
  if (!(error instanceof APIError)) {
    return error instanceof Error ? error.message : "Tool execution failed.";
  }
  const lines = [`${error.code}: ${error.message}`];
  if (error.opts.hint) lines.push(`Hint: ${error.opts.hint}`);
  if (SANDBOX_DIAGNOSTIC_CODES.has(error.code)) {
    lines.push(...sandboxDiagnosticLines(error.opts.details));
  }
  return clamp(lines.join("\n"), MAX_TOOL_ERROR_CHARACTERS);
}

function sandboxDiagnosticLines(details: Record<string, unknown> | undefined): string[] {
  if (!details) return [];
  const lines: string[] = [];
  for (const key of ["command", "exitCode", "port", "url", "durationMs", "timeoutMs"] as const) {
    const value = details[key];
    if (typeof value === "string" || typeof value === "number") {
      lines.push(`${key}: ${value}`);
    }
  }
  for (const key of ["stderr", "stdout", "logs", "output"] as const) {
    const value = details[key];
    if (typeof value === "string" && value.trim()) {
      lines.push(`${key}:\n${clamp(value.trim(), MAX_TOOL_ERROR_OUTPUT_CHARACTERS)}`);
    }
  }
  return lines;
}

function clamp(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}\n[truncated]`;
}
