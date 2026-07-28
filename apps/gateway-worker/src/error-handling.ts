import { toAPIError } from "@cheatcode/observability";

export function formatGatewayRouteError(error: unknown, requestId: string): Response {
  return toAPIError(error).toResponse(requestId);
}
