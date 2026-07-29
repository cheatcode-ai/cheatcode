import { authenticate } from "./authenticate";
import { type GatewayApp, requestDatabase } from "./gateway-env";
import { rateLimit } from "./rate-limit";
import { listRecentThreadsRoute, searchWorkspaceRoute } from "./search-routes";

export function registerSearchHttpRoutes(app: GatewayApp): void {
  app.get("/v1/search", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return searchWorkspaceRoute(requestDatabase(c), c.req.raw, userId);
  });
  app.get("/v1/threads", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return listRecentThreadsRoute(requestDatabase(c), c.req.raw, userId);
  });
}
