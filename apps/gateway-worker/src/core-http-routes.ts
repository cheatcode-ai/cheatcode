import { APIError } from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import { agentServiceRequest } from "./agent-forwarding";
import { authenticate } from "./authenticate";
import type { GatewayApp, GatewayEnv } from "./gateway-env";
import { OPENAPI_DOCUMENT, openApiDocsHtml } from "./openapi";
import { rateLimit, rateLimitPublic, withRateLimitHeaders } from "./rate-limit";
import { readDownstreamReleaseHealth } from "./release-health";
import { listUserSkillsRoute } from "./skills-routes";
import { clientErrorRoute, clientUserEventRoute, vitalsRoute } from "./telemetry-routes";
import type { WaitUntilContext } from "./wait-until-context";

export function registerCoreHttpRoutes(app: GatewayApp): void {
  registerHealthRoute(app);
  registerDiscoveryRoutes(app);
  registerTelemetryRoutes(app);
  registerOutputRoute(app);
  registerSkillRoutes(app);
}

function registerHealthRoute(app: GatewayApp): void {
  app.get("/health", async (c) => {
    const headers = await rateLimitPublic(c, "GET /health", "publicRead");
    const releaseSha = c.env.CHEATCODE_RELEASE_SHA ?? "development";
    const [{ health: agent }, { health: webhooks }] = await Promise.all([
      readDownstreamReleaseHealth(c.env, "agent"),
      readDownstreamReleaseHealth(c.env, "webhooks"),
    ]);
    if (agent.releaseSha !== releaseSha || webhooks.releaseSha !== releaseSha) {
      throw new APIError(503, "unavailable_maintenance", "Release is still converging", {
        details: {
          agentReleaseSha: agent.releaseSha,
          gatewayReleaseSha: releaseSha,
          webhooksReleaseSha: webhooks.releaseSha,
        },
        retriable: true,
      });
    }
    return withRateLimitHeaders(
      c.json({
        agent,
        ok: true,
        releaseSha,
        versionId: c.env.CF_VERSION_METADATA?.id ?? null,
        webhooks,
      }),
      headers,
    );
  });
}

function registerDiscoveryRoutes(app: GatewayApp): void {
  app.get("/openapi.json", async (c) => {
    const headers = await rateLimitPublic(c, "GET /openapi.json", "publicRead");
    return withRateLimitHeaders(
      new Response(JSON.stringify(OPENAPI_DOCUMENT), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),
      headers,
    );
  });
  app.get("/docs", async (c) => {
    await rateLimitPublic(c, "GET /docs", "publicRead");
    return c.html(openApiDocsHtml());
  });
}

function registerTelemetryRoutes(app: GatewayApp): void {
  app.post("/v1/client-error", async (c) => {
    await rateLimitPublic(c, "POST /v1/client-error", "publicWrite");
    return clientErrorRoute(c, optionalTelemetryUser);
  });
  app.post("/v1/vitals", async (c) => {
    await rateLimitPublic(c, "POST /v1/vitals", "publicWrite");
    return vitalsRoute(c);
  });
  app.post("/v1/user-events", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/user-events");
    return clientUserEventRoute(c, async () => userId);
  });
}

function registerOutputRoute(app: GatewayApp): void {
  app.post("/v1/outputs/:outputId/download-url", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    const headers = await rateLimit(c, userId, "POST /v1/outputs/:outputId/download-url");
    return withRateLimitHeaders(
      await c.env.AGENT.fetch(agentServiceRequest(c.req.raw, userId)),
      headers,
    );
  });
  app.get("/v1/outputs/:outputId/download", async (c) => {
    const headers = await rateLimitPublic(c, "GET /v1/outputs/:outputId/download", "publicRead");
    return withRateLimitHeaders(await c.env.AGENT.fetch(agentServiceRequest(c.req.raw)), headers);
  });
}

function registerSkillRoutes(app: GatewayApp): void {
  app.get("/v1/skills", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/skills");
    return listUserSkillsRoute(c.env, c.executionCtx, userId);
  });
  app.delete("/v1/skills/:skillId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    const headers = await rateLimit(c, userId, "DELETE /v1/skills/:skillId");
    return withRateLimitHeaders(
      await c.env.AGENT.fetch(agentServiceRequest(c.req.raw, userId)),
      headers,
    );
  });
}

async function optionalTelemetryUser(
  request: Request,
  env: GatewayEnv,
  ctx: WaitUntilContext,
): Promise<UserId | "anonymous"> {
  if (!request.headers.has("Authorization")) {
    return "anonymous";
  }
  try {
    return await authenticate(request, env, ctx);
  } catch {
    return "anonymous";
  }
}
