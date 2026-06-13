import { type AnalyticsBindings, type ErrorEvent, emitErrorEvent } from "./analytics";
import { toAPIError } from "./errors";
import { createLogger } from "./logger";

export interface WorkerFetchHandler<Env extends AnalyticsBindings, Ctx = unknown> {
  fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> | Response;
}

export interface ErrorHandlerOptions {
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
        const route = options.routeName?.(request) ?? defaultRouteName(request);
        emitErrorEvent(
          env,
          errorEventFrom(error, {
            errorCategory: options.errorCategory ?? options.workerName,
            errorCode: apiError.code,
            httpStatus: apiError.status,
            route,
            workerName: options.workerName,
          }),
        );
        createLogger({ requestId }).error("worker_request_failed", {
          code: apiError.code,
          route,
          workerName: options.workerName,
        });
        return apiError.toResponse(requestId);
      }
    },
  } as Handler;
}

function errorEventFrom(
  error: unknown,
  base: Pick<ErrorEvent, "errorCategory" | "errorCode" | "httpStatus" | "route" | "workerName">,
): ErrorEvent {
  const event: ErrorEvent = { ...base };
  if (error instanceof Error) {
    event.message = error.message;
    if (error.stack) {
      event.stack = error.stack;
    }
  }
  return event;
}

function defaultRouteName(request: Request): string {
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}`;
}

function fallbackRequestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}
