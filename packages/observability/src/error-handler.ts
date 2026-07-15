import { type AnalyticsBindings, type ErrorEvent, emitErrorEvent } from "./analytics";
import { safeErrorTelemetry, toAPIError } from "./errors";
import { createLogger } from "./logger";

interface WorkerFetchHandler<Env extends AnalyticsBindings, Ctx = unknown> {
  fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> | Response;
}

interface ErrorHandlerOptions {
  errorCategory?: string;
  requestId?: (request: Request) => string | null;
  routeName?: (request: Request) => string;
  workerName: string;
}

export function withErrorHandler<
  Env extends AnalyticsBindings,
  Ctx,
  Handler extends WorkerFetchHandler<Env, Ctx>,
>(handler: Handler, options: ErrorHandlerOptions): Handler {
  return {
    ...handler,
    async fetch(request, env, ctx) {
      const requestId = options.requestId?.(request) ?? fallbackRequestId();
      try {
        return await handler.fetch(request, env, ctx);
      } catch (error) {
        const apiError = toAPIError(error);
        const telemetry = safeErrorTelemetry(error);
        const route = options.routeName?.(request) ?? defaultRouteName(request);
        emitErrorEvent(
          env,
          errorEventFrom(telemetry, {
            errorCategory: options.errorCategory ?? options.workerName,
            errorCode: apiError.code,
            httpStatus: apiError.status,
            route,
            workerName: options.workerName,
          }),
        );
        createLogger({ requestId }).error("worker_request_failed", {
          apiCode: apiError.code,
          route,
          workerName: options.workerName,
          ...telemetry,
        });
        return apiError.toResponse(requestId);
      }
    },
  } as Handler;
}

function errorEventFrom(
  telemetry: ReturnType<typeof safeErrorTelemetry>,
  base: Pick<ErrorEvent, "errorCategory" | "errorCode" | "httpStatus" | "route" | "workerName">,
): ErrorEvent {
  return { ...base, ...telemetry };
}

function defaultRouteName(request: Request): string {
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}`;
}

function fallbackRequestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}
