import { AgentWorkerEnvSchema } from "@cheatcode/env";
import {
  APIError,
  createLogger,
  emitErrorEvent,
  emitPerformanceMetric,
  safeErrorTelemetry,
  toAPIError,
  withErrorHandler,
} from "@cheatcode/observability";
import {
  INTERNAL_DATABASE_READINESS_PATH,
  INTERNAL_DURABLE_OBJECT_STORAGE_PATH,
  normalizeTelemetryPath,
} from "@cheatcode/types";
import { type Context, Hono } from "hono";
import { routePath } from "hono/route";
import { registerAgentRunHttpRoutes } from "./agent-api-run-routes";
import { registerAgentSystemHttpRoutes } from "./agent-api-system-routes";
import type { AgentEnv } from "./agent-env";
import { registerAgentDatabaseReadinessRoute } from "./database-readiness";
import { registerAgentDurableObjectStorageRoute } from "./durable-object-storage";
import { AgentRun } from "./durable-objects/agent-run";
import { AgentRunWorkflow } from "./durable-objects/agent-run-workflow";
import { ProjectSandbox } from "./durable-objects/project-sandbox";
import { formatAgentRouteError } from "./error-handling";
import { registerSandboxHttpRoutes } from "./sandbox-http-routes";
import { registerSkillRuntimeExecutionRoutes } from "./skill-runtime-execution-routes";
import { registerSkillRuntimeManagedRoutes } from "./skill-runtime-managed-routes";
import { registerUserSkillHttpRoutes } from "./user-skill-http-routes";

export { AgentRun, AgentRunWorkflow, ProjectSandbox };

export const agentApp = new Hono<{ Bindings: AgentEnv }>();

agentApp.onError((error, c) => {
  const id = c.req.header("X-Request-Id") ?? requestId();
  const apiError = toAPIError(error);
  const route = registeredRouteName(c);
  logAgentRequestError(error, id, route);
  emitErrorEvent(c.env, {
    errorCategory: "agent",
    errorCode: apiError.code,
    httpStatus: apiError.status,
    route,
    workerName: "agent",
    ...safeErrorTelemetry(error),
  });
  return formatAgentRouteError(error, id);
});

agentApp.use("*", async (c, next) => {
  const startedAt = performance.now();
  let status = 500;
  try {
    await next();
    status = c.res.status;
  } finally {
    emitPerformanceMetric(c.env, {
      route: registeredRouteName(c),
      statusClass: statusClass(status),
      totalMs: performance.now() - startedAt,
      workerName: "agent",
    });
  }
});

agentApp.get("/health", (c) =>
  c.json({
    ok: true,
    releaseGate: c.env.CHEATCODE_RELEASE_GATE,
    releaseSha: c.env.CHEATCODE_RELEASE_SHA ?? "development",
    versionId: c.env.CF_VERSION_METADATA?.id ?? null,
    worker: "agent",
  }),
);

registerAgentDatabaseReadinessRoute(agentApp);
registerAgentDurableObjectStorageRoute(agentApp);
registerAgentSystemHttpRoutes(agentApp);
registerAgentRunHttpRoutes(agentApp);
registerSandboxHttpRoutes(agentApp);
registerUserSkillHttpRoutes(agentApp);
registerSkillRuntimeManagedRoutes(agentApp);
registerSkillRuntimeExecutionRoutes(agentApp);

const agentHandler = {
  async fetch(request: Request, env: AgentEnv, ctx: ExecutionContext): Promise<Response> {
    AgentWorkerEnvSchema.parse(env);
    const id = request.headers.get("X-Request-Id") ?? requestId();
    try {
      const releaseGate = agentReleaseGateResponse(request, env, id);
      if (releaseGate) {
        return releaseGate;
      }
      const requestWithId = isWebSocketUpgrade(request) ? request : new Request(request);
      if (!isWebSocketUpgrade(requestWithId)) {
        requestWithId.headers.set("X-Request-Id", id);
      }
      return withRequestId(await agentApp.fetch(requestWithId, env, ctx), id);
    } catch (error) {
      const apiError = toAPIError(error);
      logAgentRequestError(error, id, routeName(request));
      emitErrorEvent(env, {
        errorCategory: "agent",
        errorCode: apiError.code,
        httpStatus: apiError.status,
        route: routeName(request),
        workerName: "agent",
        ...safeErrorTelemetry(error),
      });
      return apiError.toResponse(id);
    }
  },
};

const WORKSPACE_RECONCILIATION_PATH =
  /^\/internal\/users\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/reconcile-workspaces$/u;
const USER_STATE_DELETION_PATH =
  /^\/internal\/users\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/delete-state$/u;

function agentReleaseGateResponse(
  request: Request,
  env: AgentEnv,
  id: string,
): Response | undefined {
  if (env.CHEATCODE_RELEASE_GATE === "open") {
    return undefined;
  }
  const pathname = new URL(request.url).pathname;
  if (
    env.CHEATCODE_RELEASE_GATE === "closed" &&
    request.method === "POST" &&
    (pathname === INTERNAL_DATABASE_READINESS_PATH ||
      pathname === INTERNAL_DURABLE_OBJECT_STORAGE_PATH)
  ) {
    return undefined;
  }
  if (
    request.method === "POST" &&
    ((env.CHEATCODE_RELEASE_GATE === "draining" && USER_STATE_DELETION_PATH.test(pathname)) ||
      (env.CHEATCODE_RELEASE_GATE === "closed" && WORKSPACE_RECONCILIATION_PATH.test(pathname)))
  ) {
    return undefined;
  }
  if (request.method === "GET" && pathname === "/health") {
    return withRequestId(
      Response.json(
        {
          ok: true,
          releaseGate: env.CHEATCODE_RELEASE_GATE,
          releaseSha: env.CHEATCODE_RELEASE_SHA ?? "development",
          versionId: env.CF_VERSION_METADATA?.id ?? null,
          worker: "agent",
        },
        { headers: { "Cache-Control": "no-store" } },
      ),
      id,
    );
  }
  const response = new APIError(503, "unavailable_maintenance", "Release is in progress", {
    details: {
      releaseGate: env.CHEATCODE_RELEASE_GATE,
      releaseSha: env.CHEATCODE_RELEASE_SHA ?? null,
      versionId: env.CF_VERSION_METADATA?.id ?? null,
      worker: "agent",
    },
    retriable: true,
  }).toResponse(id);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Retry-After", "5");
  return response;
}

function logAgentRequestError(error: unknown, requestIdValue: string, route: string): void {
  const apiError = toAPIError(error);
  createLogger({ requestId: requestIdValue }).error("agent_request_failed", {
    apiCode: apiError.code,
    route,
    workerName: "agent",
    ...safeErrorTelemetry(error),
  });
}

function requestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function withRequestId(response: Response, id: string): Response {
  if (response.status === 101 || response.webSocket) {
    return response;
  }
  const wrapped = new Response(response.body, response);
  wrapped.headers.set("X-Request-Id", id);
  return wrapped;
}

function routeName(request: Request): string {
  const url = new URL(request.url);
  return `${request.method} ${normalizeTelemetryPath(url.pathname)}`;
}

function registeredRouteName(c: Context<{ Bindings: AgentEnv }>): string {
  try {
    return `${c.req.method} ${routePath(c, -1)}`;
  } catch {
    return routeName(c.req.raw);
  }
}

function statusClass(status: number): string {
  if (status >= 500) {
    return "5xx";
  }
  if (status >= 400) {
    return "4xx";
  }
  if (status >= 300) {
    return "3xx";
  }
  return "2xx";
}

function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}

export default withErrorHandler(agentHandler, {
  errorCategory: "agent",
  requestId: (request) => request.headers.get("X-Request-Id"),
  routeName,
  workerName: "agent",
});
