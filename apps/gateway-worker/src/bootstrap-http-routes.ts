import { authenticate } from "./authenticate";
import { navigationBootstrapRoute } from "./bootstrap-routes";
import { type GatewayApp, requestDatabase } from "./gateway-env";
import { rateLimit } from "./rate-limit";

export function registerBootstrapHttpRoutes(app: GatewayApp): void {
  app.get("/v1/bootstrap", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return navigationBootstrapRoute(requestDatabase(c), c.req.raw, userId);
  });
}
