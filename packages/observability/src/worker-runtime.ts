import type { AnalyticsBindings } from "./analytics";
import { emitErrorEvent, emitPerformanceMetric } from "./analytics";
import { safeErrorTelemetry, toAPIError } from "./errors";
import { createLogger } from "./logger";

const ROUTED_WORKER_ERROR = Symbol("routed-worker-error");

interface RoutedWorkerError {
  readonly [ROUTED_WORKER_ERROR]: true;
  readonly error: unknown;
  readonly route: string;
}

interface WorkerRuntimeOptions<Env extends AnalyticsBindings, Ctx> {
  errorCategory?: string;
  errorLogFields?: (input: {
    apiError: ReturnType<typeof toAPIError>;
    error: unknown;
    request: Request;
    route: string;
  }) => Record<string, unknown>;
  errorLogName: string;
  fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> | Response;
  formatError?: (input: {
    apiError: ReturnType<typeof toAPIError>;
    env: Env;
    error: unknown;
    request: Request;
    requestId: string;
  }) => Response;
  performanceRouteName?: (request: Request) => string;
  requestId?: (request: Request) => string;
  routeName?: (request: Request) => string;
  workerName: string;
}

interface PerformanceContext<Env extends AnalyticsBindings> {
  env: Env;
  readonly res: Response;
}

interface PerformanceMiddlewareOptions<Context> {
  errorStatus?: (error: unknown) => number;
  routeName: (context: Context) => string;
  workerName: string;
}

export function createWorkerRuntime<Env extends AnalyticsBindings, Ctx>(
  options: WorkerRuntimeOptions<Env, Ctx>,
): { fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> } {
  return {
    async fetch(request, env, ctx) {
      const id = options.requestId?.(request) ?? requestId();
      const requestWithId = requestWithRequestId(request, id);
      const startedAt = performance.now();
      let status = 500;
      try {
        const response = await options.fetch(requestWithId, env, ctx);
        status = response.status;
        return withRequestId(response, id);
      } catch (error) {
        const response = formatWorkerError(options, env, requestWithId, id, error);
        status = response.status;
        return withRequestId(response, id);
      } finally {
        if (options.performanceRouteName) {
          emitPerformanceMetric(env, {
            route: options.performanceRouteName(requestWithId),
            statusClass: statusClass(status),
            totalMs: performance.now() - startedAt,
            workerName: options.workerName,
          });
        }
      }
    },
  };
}

interface ReportWorkerErrorInput {
  error: unknown;
  errorCategory?: string;
  errorLogFields?: Record<string, unknown>;
  errorLogName: string;
  requestId: string;
  route: string;
  workerName: string;
}

/**
 * Emit the error event and log exactly once and return the classified APIError.
 * Routers that answer errors in-band (so response middleware still applies) must
 * call this instead of rethrowing into the runtime's catch-all.
 */
export function reportWorkerError(
  env: AnalyticsBindings,
  input: ReportWorkerErrorInput,
): ReturnType<typeof toAPIError> {
  const apiError = toAPIError(input.error);
  const telemetry = safeErrorTelemetry(input.error);
  emitErrorEvent(env, {
    errorCategory: input.errorCategory ?? input.workerName,
    errorCode: apiError.code,
    httpStatus: apiError.status,
    route: input.route,
    workerName: input.workerName,
    ...telemetry,
  });
  createLogger({ requestId: input.requestId }).error(input.errorLogName, {
    apiCode: apiError.code,
    ...input.errorLogFields,
    ...telemetry,
  });
  return apiError;
}

function formatWorkerError<Env extends AnalyticsBindings, Ctx>(
  options: WorkerRuntimeOptions<Env, Ctx>,
  env: Env,
  request: Request,
  id: string,
  error: unknown,
): Response {
  const routed = routedWorkerError(error);
  const sourceError = routed?.error ?? error;
  const route = routed?.route ?? options.routeName?.(request) ?? routeName(request);
  const logFields = options.errorLogFields?.({
    apiError: toAPIError(sourceError),
    error: sourceError,
    request,
    route,
  });
  const apiError = reportWorkerError(env, {
    error: sourceError,
    errorLogName: options.errorLogName,
    requestId: id,
    route,
    workerName: options.workerName,
    ...(logFields === undefined ? {} : { errorLogFields: logFields }),
    ...(options.errorCategory === undefined ? {} : { errorCategory: options.errorCategory }),
  });
  return (
    options.formatError?.({ apiError, env, error: sourceError, request, requestId: id }) ??
    apiError.toResponse(id)
  );
}

export function createPerformanceMetricMiddleware<
  Env extends AnalyticsBindings,
  Context extends PerformanceContext<Env>,
>(
  options: PerformanceMiddlewareOptions<Context>,
): (context: Context, next: () => Promise<void>) => Promise<void> {
  return async (context, next) => {
    const startedAt = performance.now();
    let status = 500;
    try {
      await next();
      status = context.res.status;
    } catch (error) {
      const sourceError = routedWorkerError(error)?.error ?? error;
      status = options.errorStatus?.(sourceError) ?? toAPIError(sourceError).status;
      throw error;
    } finally {
      emitPerformanceMetric(context.env, {
        route: options.routeName(context),
        statusClass: statusClass(status),
        totalMs: performance.now() - startedAt,
        workerName: options.workerName,
      });
    }
  };
}

export function routeWorkerError(error: unknown, route: string): unknown {
  return {
    [ROUTED_WORKER_ERROR]: true,
    error,
    route,
  } satisfies RoutedWorkerError;
}

export function requestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function withRequestId(response: Response, id: string): Response {
  if (response.status === 101) {
    return response;
  }
  const wrapped = new Response(response.body, response);
  wrapped.headers.set("X-Request-Id", id);
  return wrapped;
}

export function routeName(request: Request): string {
  return `${request.method} ${new URL(request.url).pathname}`;
}

function statusClass(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}

function requestWithRequestId(request: Request, id: string): Request {
  if (isWebSocketUpgrade(request)) {
    return request;
  }
  const requestWithId = new Request(request);
  requestWithId.headers.set("X-Request-Id", id);
  return requestWithId;
}

function routedWorkerError(error: unknown): RoutedWorkerError | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const candidate = error as Partial<RoutedWorkerError>;
  return candidate[ROUTED_WORKER_ERROR] === true && typeof candidate.route === "string"
    ? (candidate as RoutedWorkerError)
    : undefined;
}
