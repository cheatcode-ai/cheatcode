import { AgentWorkerEnvSchema } from "@cheatcode/env";
import {
  createPerformanceMetricMiddleware,
  createWorkerRuntime,
  requestId,
  routeWorkerError,
} from "@cheatcode/observability";
import { normalizeTelemetryPath } from "@cheatcode/types";
import { type Context, Hono } from "hono";
import { routePath } from "hono/route";
import { registerAgentRunHttpRoutes } from "./agent-api-run-routes";
import { registerAgentSystemHttpRoutes } from "./agent-api-system-routes";
import type { AgentEnv } from "./agent-env";
import { AgentLifecycleEntrypoint } from "./agent-lifecycle-entrypoint";
import { AgentRun } from "./durable-objects/agent-run";
import { AgentRunWorkflow } from "./durable-objects/agent-run-workflow";
import { ProjectSandbox } from "./durable-objects/project-sandbox";
import { QuotaTracker } from "./durable-objects/quota-tracker";
import { formatAgentRouteError, toAgentRouteError } from "./error-handling";
import { GatewayQuotaEntrypoint } from "./gateway-quota-entrypoint";
import { registerProjectFileHttpRoutes } from "./project-file-http-routes";
import { QuotaDeletionEntrypoint } from "./quota-deletion-entrypoint";
import { registerSandboxPreviewHttpRoutes } from "./sandbox-preview-http-routes";
import { registerSandboxTerminalHttpRoutes } from "./sandbox-terminal-http-routes";
import { registerSkillRuntimeExecutionRoutes } from "./skill-runtime-execution-routes";
import { registerSkillRuntimeManagedRoutes } from "./skill-runtime-managed-routes";
import { registerUserSkillHttpRoutes } from "./user-skill-http-routes";

export {
  AgentLifecycleEntrypoint,
  AgentRun,
  AgentRunWorkflow,
  GatewayQuotaEntrypoint,
  ProjectSandbox,
  QuotaDeletionEntrypoint,
  QuotaTracker,
};

export const agentApp = new Hono<{ Bindings: AgentEnv }>();

agentApp.onError((error, context) => {
  throw routeWorkerError(error, registeredRouteName(context));
});

agentApp.use(
  "*",
  createPerformanceMetricMiddleware<AgentEnv, Context<{ Bindings: AgentEnv }>>({
    errorStatus: (error) => toAgentRouteError(error).status,
    routeName: registeredRouteName,
    workerName: "agent",
  }),
);

agentApp.get("/health", (c) =>
  c.json({
    ok: true,
    releaseSha: c.env.CHEATCODE_RELEASE_SHA ?? "development",
    versionId: c.env.CF_VERSION_METADATA?.id ?? null,
    worker: "agent",
  }),
);

registerAgentSystemHttpRoutes(agentApp);
registerAgentRunHttpRoutes(agentApp);
registerProjectFileHttpRoutes(agentApp);
registerSandboxPreviewHttpRoutes(agentApp);
registerSandboxTerminalHttpRoutes(agentApp);
registerUserSkillHttpRoutes(agentApp);
registerSkillRuntimeManagedRoutes(agentApp);
registerSkillRuntimeExecutionRoutes(agentApp);

const agentHandler = createWorkerRuntime<AgentEnv, ExecutionContext>({
  errorCategory: "agent",
  errorLogFields: ({ route }) => ({ route, workerName: "agent" }),
  errorLogName: "agent_request_failed",
  fetch: async (request, env, ctx) => {
    AgentWorkerEnvSchema.parse(env);
    return agentApp.fetch(request, env, ctx);
  },
  formatError: ({ error, requestId: id }) => formatAgentRouteError(error, id),
  requestId: (request) => request.headers.get("X-Request-Id") ?? requestId(),
  routeName,
  workerName: "agent",
});

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

export default agentHandler;
