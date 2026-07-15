import { createLogger, safeErrorTelemetry, toAPIError } from "@cheatcode/observability";

export function formatGatewayRouteError(error: unknown, requestId: string): Response {
  const apiError = toAPIError(error);
  createLogger({ requestId }).error("gateway_request_failed", {
    apiCode: apiError.code,
    ...safeErrorTelemetry(error),
  });
  return apiError.toResponse(requestId);
}
