import { APIError, safeErrorTelemetry } from "@cheatcode/observability";
import { type ErrorCode, ErrorCodeSchema } from "@cheatcode/types";

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

  const telemetry = safeErrorTelemetry(error);
  const code = errorCodeFromTelemetry(telemetry.sourceErrorCode, telemetry.causeCode);
  if (code) {
    return {
      code,
      message: workflowFailureMessage(code),
      retriable: telemetry.retriable ?? telemetry.causeRetriable ?? true,
    };
  }

  return {
    code: "tool_execution_failed",
    message: "Agent run failed unexpectedly",
    retriable: true,
  };
}

function errorCodeFromTelemetry(...candidates: Array<string | undefined>): ErrorCode | undefined {
  for (const candidate of candidates) {
    const parsed = ErrorCodeSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

function workflowFailureMessage(code: ErrorCode): string {
  if (
    code === "sandbox_start_failed" ||
    code === "upstream_sandbox_failed" ||
    code === "upstream_sandbox_timeout"
  ) {
    return "The computer could not complete this operation";
  }
  if (code === "internal_service_error" || code === "service_maintenance_unavailable") {
    return "The agent service could not complete this run";
  }
  return "Agent run failed before it could finish";
}
