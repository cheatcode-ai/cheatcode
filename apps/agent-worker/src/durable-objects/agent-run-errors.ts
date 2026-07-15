import { APIError } from "@cheatcode/observability";
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
      retriable: error.retriable,
    };
  }

  return {
    code: "tool_execution_failed",
    message: "Agent run failed unexpectedly",
    retriable: true,
  };
}
