import { createDb } from "@cheatcode/db";
import { authenticate } from "./authenticate";
import type { GatewayApp } from "./gateway-env";
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
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/integrations");
    const { db, close } = createDb(c.env.HYPERDRIVE, {
      audience: "app_gateway",
      signingSecret: c.env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
    });
    try {
      const integrations = await listIntegrationSummaries(db, c.env, userId);
      return c.json(integrations);
    } finally {
      c.executionCtx.waitUntil(close());
    }
  });
  app.get("/v1/integrations/catalog", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/integrations/catalog");
    const { db, close } = createDb(c.env.HYPERDRIVE, {
      audience: "app_gateway",
      signingSecret: c.env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
    });
    try {
      const catalog = await getIntegrationCatalog(db, c.env, userId);
      return c.json(catalog);
    } finally {
      c.executionCtx.waitUntil(close());
    }
  });
  app.get("/v1/integrations/:name/tools", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/integrations/:name/tools");
    return c.json(await listToolkitActions(c.env, parseIntegrationName(c.req.param("name"))));
  });
  app.post("/v1/integrations/:name/connect", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/integrations/:name/connect");
    const integration = parseIntegrationName(c.req.param("name"));
    const { db, close } = createDb(c.env.HYPERDRIVE, {
      audience: "app_gateway",
      signingSecret: c.env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
    });
    try {
      return await connectIntegration({ db, env: c.env, integration, request: c.req.raw, userId });
    } finally {
      c.executionCtx.waitUntil(close());
    }
  });
  registerIntegrationAccountRoutes(app);
}

function registerIntegrationAccountRoutes(app: GatewayApp): void {
  app.post("/v1/integrations/:name/accounts/:connectionId/default", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/integrations/:name/accounts/:connectionId/default");
    const integration = parseIntegrationName(c.req.param("name"));
    const { db, close } = createDb(c.env.HYPERDRIVE, {
      audience: "app_gateway",
      signingSecret: c.env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
    });
    try {
      await makeIntegrationAccountDefault({
        composioConnectionId: parseComposioConnectionId(c.req.param("connectionId")),
        db,
        integration,
        userId,
      });
      return c.body(null, 204);
    } finally {
      c.executionCtx.waitUntil(close());
    }
  });
  app.delete("/v1/integrations/:name/accounts/:connectionId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "DELETE /v1/integrations/:name/accounts/:connectionId");
    const integration = parseIntegrationName(c.req.param("name"));
    const { db, close } = createDb(c.env.HYPERDRIVE, {
      audience: "app_gateway",
      signingSecret: c.env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
    });
    try {
      await deleteIntegrationAccount({
        composioConnectionId: parseComposioConnectionId(c.req.param("connectionId")),
        db,
        env: c.env,
        integration,
        userId,
      });
      return c.body(null, 204);
    } finally {
      c.executionCtx.waitUntil(close());
    }
  });
}
