import { getActivityHistoryRoute } from "./activity-routes";
import { authenticate } from "./authenticate";
import { type GatewayApp, requestDatabase } from "./gateway-env";
import { rateLimit } from "./rate-limit";

export function registerActivityHttpRoutes(app: GatewayApp): void {
  app.get("/v1/activity", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return getActivityHistoryRoute(requestDatabase(c), c.env, c.req.raw, userId);
  });
}
