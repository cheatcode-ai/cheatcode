import { ArtifactWorkerEnvSchema } from "@cheatcode/env";
import {
  createPerformanceMetricMiddleware,
  createWorkerRuntime,
  requestId,
  routeWorkerError,
  toAPIError,
} from "@cheatcode/observability";
import { normalizeTelemetryPath } from "@cheatcode/types";
import { type Context, Hono } from "hono";
import { routePath } from "hono/route";
import type { ArtifactEnv } from "./artifact-env";
import { registerOutputRoutes } from "./output-routes";

const artifactApp = new Hono<{ Bindings: ArtifactEnv }>();

artifactApp.onError((error, context) => {
  throw routeWorkerError(error, registeredRouteName(context));
});

artifactApp.use(
  "*",
  createPerformanceMetricMiddleware<ArtifactEnv, Context<{ Bindings: ArtifactEnv }>>({
    errorStatus: (error) => toAPIError(error).status,
    metricFields: (c) => {
      const colo = requestColo(c.req.raw);
      const placement = c.req.header("cf-placement");
      return {
        ...(colo ? { colo } : {}),
        envTag: c.env.CHEATCODE_ENVIRONMENT,
        ...(placement ? { placement } : {}),
        ...(c.env.CF_VERSION_METADATA?.id || c.env.CHEATCODE_RELEASE_SHA
          ? { versionTag: c.env.CF_VERSION_METADATA?.id ?? c.env.CHEATCODE_RELEASE_SHA }
          : {}),
      };
    },
    routeName: registeredRouteName,
    workerName: "artifact",
  }),
);

artifactApp.get("/health", (c) =>
  c.json({
    ok: true,
    releaseSha: c.env.CHEATCODE_RELEASE_SHA ?? "development",
    versionId: c.env.CF_VERSION_METADATA?.id ?? null,
    worker: "artifact",
  }),
);

registerOutputRoutes(artifactApp);

export default createWorkerRuntime<ArtifactEnv, ExecutionContext>({
  errorCategory: "artifact",
  errorLogFields: ({ route }) => ({ route, workerName: "artifact" }),
  errorLogName: "artifact_request_failed",
  fetch: async (request, env, ctx) => {
    ArtifactWorkerEnvSchema.parse(env);
    return artifactApp.fetch(request, env, ctx);
  },
  formatError: ({ error, requestId: id }) => toAPIError(error).toResponse(id),
  requestId: (request) => request.headers.get("X-Request-Id") ?? requestId(),
  routeName,
  workerName: "artifact",
});

function routeName(request: Request): string {
  const url = new URL(request.url);
  return `${request.method} ${normalizeTelemetryPath(url.pathname)}`;
}

function registeredRouteName(c: Context<{ Bindings: ArtifactEnv }>): string {
  try {
    return `${c.req.method} ${routePath(c, -1)}`;
  } catch {
    return routeName(c.req.raw);
  }
}

function requestColo(request: Request): string | undefined {
  const colo = request.cf?.colo;
  return typeof colo === "string" ? colo : undefined;
}
