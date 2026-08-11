import { findAPIError } from "@cheatcode/observability";
import { ErrorCodeSchema } from "@cheatcode/types";
import { z } from "zod";

const MAX_TOOL_ERROR_CHARACTERS = 8_000;
const MAX_TOOL_ERROR_OUTPUT_CHARACTERS = 3_000;
const SANDBOX_DIAGNOSTIC_CODES = new Set([
  "sandbox_command_failed",
  "sandbox_start_failed",
  "upstream_sandbox_timeout",
]);

export const AgentToolErrorOutputSchema = z.strictObject({
  code: ErrorCodeSchema,
  diagnostics: z.string().optional(),
  hint: z.string().optional(),
  message: z.string(),
  retriable: z.boolean(),
});

export type AgentToolErrorOutput = z.infer<typeof AgentToolErrorOutputSchema>;

/** Preserves retry policy and bounded, user-scoped diagnostics for the model's next turn. */
export function agentToolErrorOutput(error: unknown): AgentToolErrorOutput {
  const apiError = findAPIError(error);
  if (!apiError) {
    return AgentToolErrorOutputSchema.parse({
      code: "tool_execution_failed",
      message: clamp(
        error instanceof Error ? error.message : "Tool execution failed.",
        MAX_TOOL_ERROR_CHARACTERS,
      ),
      retriable: false,
    });
  }
  const diagnostics = SANDBOX_DIAGNOSTIC_CODES.has(apiError.code)
    ? sandboxDiagnosticLines(apiError.opts.details).join("\n")
    : "";
  return AgentToolErrorOutputSchema.parse({
    code: apiError.code,
    ...(diagnostics ? { diagnostics: clamp(diagnostics, MAX_TOOL_ERROR_CHARACTERS) } : {}),
    ...(apiError.opts.hint ? { hint: clamp(apiError.opts.hint, MAX_TOOL_ERROR_CHARACTERS) } : {}),
    message: clamp(apiError.message, MAX_TOOL_ERROR_CHARACTERS),
    retriable: apiError.retriable,
  });
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
