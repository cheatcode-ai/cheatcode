import { withUserDb } from "@cheatcode/db";
import { authenticate } from "./authenticate";
import { type GatewayApp, requestDatabase } from "./gateway-env";
import {
  connectIntegration,
  deleteIntegrationAccount,
  listIntegrationSummaries,
  makeIntegrationAccountDefault,
  parseComposioConnectionId,
  parseIntegrationName,
} from "./integrations";
import { getIntegrationCatalog, listToolkitActions } from "./integrations-catalog";
import { rateLimit } from "./rate-limit";

export function registerIntegrationHttpRoutes(app: GatewayApp): void {
  app.get("/v1/integrations", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
      const integrations = await listIntegrationSummaries(transaction, c.env, userId);
      return c.json(integrations);
    });
  });
  app.get("/v1/integrations/catalog", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
      const catalog = await getIntegrationCatalog(transaction, c.env, userId);
      return c.json(catalog);
    });
  });
  app.get("/v1/integrations/:name/tools", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return c.json(await listToolkitActions(c.env, parseIntegrationName(c.req.param("name"))));
  });
  app.post("/v1/integrations/:name/connect", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    const integration = parseIntegrationName(c.req.param("name"));
    return withUserDb(requestDatabase(c), userId, ({ transaction }) =>
      connectIntegration({ env: c.env, integration, request: c.req.raw, transaction, userId }),
    );
  });
  registerIntegrationAccountRoutes(app);
}

function registerIntegrationAccountRoutes(app: GatewayApp): void {
  app.post("/v1/integrations/:name/accounts/:connectionId/default", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    const integration = parseIntegrationName(c.req.param("name"));
    return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
      await makeIntegrationAccountDefault({
        composioConnectionId: parseComposioConnectionId(c.req.param("connectionId")),
        integration,
        transaction,
        userId,
      });
      return c.body(null, 204);
    });
  });
  app.delete("/v1/integrations/:name/accounts/:connectionId", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    const integration = parseIntegrationName(c.req.param("name"));
    return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
      await deleteIntegrationAccount({
        composioConnectionId: parseComposioConnectionId(c.req.param("connectionId")),
        env: c.env,
        integration,
        transaction,
        userId,
      });
      return c.body(null, 204);
    });
  });
}
