import { authenticate } from "./authenticate";
import { type GatewayApp, requestDatabase } from "./gateway-env";
import { getMyProfileRoute, updateMyProfileRoute } from "./profile-routes";
import { rateLimit } from "./rate-limit";

export function registerProfileHttpRoutes(app: GatewayApp): void {
  app.get("/v1/me/profile", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return getMyProfileRoute(requestDatabase(c), c.executionCtx, userId);
  });
  app.patch("/v1/me/profile", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return updateMyProfileRoute(requestDatabase(c), c.env, c.executionCtx, c.req.raw, userId);
  });
}
