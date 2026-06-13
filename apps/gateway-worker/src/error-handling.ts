import { createLogger, toAPIError } from "@cheatcode/observability";

function errorLogFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const cause = error.cause;
    return {
      causeMessage: cause instanceof Error ? cause.message : undefined,
      causeName: cause instanceof Error ? cause.name : undefined,
      errorMessage: error.message,
      errorName: error.name,
    };
  }
  return { errorType: typeof error };
}

export function formatGatewayRouteError(error: unknown, requestId: string): Response {
  const apiError = toAPIError(error);
  createLogger({ requestId }).error("gateway_request_failed", {
    code: apiError.code,
    ...errorLogFields(error),
  });
  return apiError.toResponse(requestId);
}
