import { authenticate } from "./authenticate";
import { type GatewayApp, requestDatabase } from "./gateway-env";
import { greetingRoute } from "./greeting-routes";
import { rateLimit } from "./rate-limit";

export function registerGreetingHttpRoutes(app: GatewayApp): void {
  app.get("/v1/greeting", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return greetingRoute(requestDatabase(c), c.executionCtx, c.req.raw, userId);
  });
}
