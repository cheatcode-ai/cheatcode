import { getActivityHistoryRoute } from "./activity-routes";
import { authenticate, readRequiredSecret } from "./authenticate";
import { myUsageRoute } from "./billing-routes";
import type { GatewayApp } from "./gateway-env";
import { greetingRoute } from "./greeting-routes";
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
