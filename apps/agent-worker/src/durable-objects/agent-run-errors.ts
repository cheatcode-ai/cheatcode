import { APIError, normalizeUnknownError } from "@cheatcode/observability";
import type { ErrorCode } from "@cheatcode/types";

export interface AgentRunStreamError {
  code: ErrorCode;
  message: string;
  retriable: boolean;
}

export function toAgentRunStreamError(error: unknown): AgentRunStreamError {
  if (error instanceof APIError) {
    return {
      code: error.code,
      message: error.message,
      retriable: error.opts.retriable ?? false,
    };
  }

  return {
    code: "tool_execution_failed",
    message: normalizeUnknownError(error, "Unknown agent error").message,
    retriable: true,
  };
}
