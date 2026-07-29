import { APIError } from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import { AGENT_FORWARD_ROUTES } from "@cheatcode/types/internal";
import { forwardAgentRequest, forwardPublicAgentRequest } from "./agent-forwarding";
import { authenticate } from "./authenticate";
import type { GatewayApp, GatewayEnv } from "./gateway-env";
import { rateLimit, rateLimitPublic, withRateLimitHeaders } from "./rate-limit";
import { readDownstreamReleaseHealth } from "./release-health";
import { listUserSkillsRoute } from "./skills-routes";
import { clientErrorRoute, clientUserEventRoute, vitalsRoute } from "./telemetry-routes";
import type { WaitUntilContext } from "./wait-until-context";

export function registerCoreHttpRoutes(app: GatewayApp): void {
  registerHealthRoute(app);
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
  const { downloadOutput, mintOutputDownloadUrl } = AGENT_FORWARD_ROUTES.core;
  app.on(mintOutputDownloadUrl.method, mintOutputDownloadUrl.path, (c) =>
    forwardAgentRequest(c, mintOutputDownloadUrl),
  );
  app.on(downloadOutput.method, downloadOutput.path, (c) =>
    forwardPublicAgentRequest(c, downloadOutput),
  );
}

function registerSkillRoutes(app: GatewayApp): void {
  app.get("/v1/skills", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/skills");
    return listUserSkillsRoute(c.env, c.executionCtx, userId);
  });
  const route = AGENT_FORWARD_ROUTES.core.deleteUserSkill;
  app.on(route.method, route.path, (c) => forwardAgentRequest(c, route));
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
