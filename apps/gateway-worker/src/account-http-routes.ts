import { createDb } from "@cheatcode/db";
import { getActivityHistoryRoute } from "./activity-routes";
import { authenticate, readRequiredSecret } from "./authenticate";
import { myUsageRoute } from "./billing-routes";
import type { GatewayApp, GatewayContext } from "./gateway-env";
import { greetingRoute } from "./greeting-routes";
import { buildLimitsSnapshot } from "./limits";
import { getMyProfileRoute, updateMyProfileRoute } from "./profile-routes";
import { rateLimit } from "./rate-limit";
import { listRecentThreadsRoute, searchWorkspaceRoute } from "./search-routes";

export function registerAccountHttpRoutes(app: GatewayApp): void {
  app.get("/v1/me/profile", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/me/profile");
    return getMyProfileRoute(c.env, c.executionCtx, userId);
  });
  app.patch("/v1/me/profile", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "PATCH /v1/me/profile");
    return updateMyProfileRoute(c.env, c.executionCtx, c.req.raw, userId);
  });
  app.get("/v1/me/usage", (c) => myUsageRoute(c, { authenticate, readRequiredSecret }));
  app.get("/v1/limits", async (c) => limitsRoute(c));
  app.get("/v1/activity", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/activity");
    return getActivityHistoryRoute(c.env, c.executionCtx, c.req.raw, userId);
  });
  app.get("/v1/search", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/search");
    return searchWorkspaceRoute(c.env, c.executionCtx, c.req.raw, userId);
  });
  app.get("/v1/threads", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/threads");
    return listRecentThreadsRoute(c.env, c.executionCtx, c.req.raw, userId);
  });
  app.get("/v1/greeting", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/greeting");
    return greetingRoute(c.env, c.executionCtx, c.req.raw, userId);
  });
}

async function limitsRoute(c: GatewayContext): Promise<Response> {
  const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
  await rateLimit(c, userId, "GET /v1/limits");
  const { db, close } = createDb(c.env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: c.env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const snapshot = await buildLimitsSnapshot(c.env, db, userId);
    return c.json(snapshot);
  } finally {
    c.executionCtx.waitUntil(close());
  }
}
