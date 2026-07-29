import { AGENT_FORWARD_ROUTES } from "@cheatcode/types/internal";
import { forwardAgentRequest } from "./agent-forwarding";
import { authenticate } from "./authenticate";
import { type GatewayApp, requestDatabase } from "./gateway-env";
import {
  createChatRoute,
  createProjectRoute,
  deleteProjectRoute,
  deleteThreadRoute,
  getProjectRoute,
  getThreadRoute,
  listProjectsRoute,
  listProjectThreadsRoute,
  listThreadMessagesRoute,
  parseProjectParam,
  parseThreadParam,
  updateProjectRoute,
  updateThreadRoute,
} from "./project-routes";
import { rateLimit } from "./rate-limit";

export function registerProjectHttpRoutes(app: GatewayApp): void {
  registerProjectCollectionRoutes(app);
  registerProjectItemRoutes(app);
  registerProjectRelatedRoutes(app);
  registerThreadRoutes(app);
}

function registerProjectCollectionRoutes(app: GatewayApp): void {
  app.get("/v1/projects", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return listProjectsRoute(requestDatabase(c), c.executionCtx, c.req.raw, userId);
  });
  app.post("/v1/projects", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return createProjectRoute(requestDatabase(c), c.executionCtx, c.req.raw, userId);
  });
}

function registerProjectItemRoutes(app: GatewayApp): void {
  app.get("/v1/projects/:projectId", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return getProjectRoute(
      requestDatabase(c),
      c.executionCtx,
      parseProjectParam(c.req.param("projectId")),
      userId,
    );
  });
  app.patch("/v1/projects/:projectId", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return updateProjectRoute(
      requestDatabase(c),
      c.executionCtx,
      c.req.raw,
      parseProjectParam(c.req.param("projectId")),
      userId,
    );
  });
  app.delete("/v1/projects/:projectId", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return deleteProjectRoute(
      c.env,
      requestDatabase(c),
      c.executionCtx,
      parseProjectParam(c.req.param("projectId")),
      userId,
    );
  });
}

function registerProjectRelatedRoutes(app: GatewayApp): void {
  for (const route of Object.values(AGENT_FORWARD_ROUTES.project)) {
    app.on(route.method, route.path, (c) => forwardAgentRequest(c, route));
  }
  app.get("/v1/projects/:projectId/threads", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return listProjectThreadsRoute(
      requestDatabase(c),
      c.executionCtx,
      c.req.raw,
      parseProjectParam(c.req.param("projectId")),
      userId,
    );
  });
}

function registerThreadRoutes(app: GatewayApp): void {
  app.post("/v1/threads", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return createChatRoute(requestDatabase(c), c.executionCtx, c.req.raw, userId);
  });
  app.get("/v1/threads/:threadId", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return getThreadRoute(
      requestDatabase(c),
      c.executionCtx,
      parseThreadParam(c.req.param("threadId")),
      userId,
    );
  });
  app.patch("/v1/threads/:threadId", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return updateThreadRoute(
      requestDatabase(c),
      c.executionCtx,
      c.req.raw,
      parseThreadParam(c.req.param("threadId")),
      userId,
    );
  });
  app.delete("/v1/threads/:threadId", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return deleteThreadRoute(
      c.env,
      requestDatabase(c),
      c.executionCtx,
      parseThreadParam(c.req.param("threadId")),
      userId,
    );
  });
  app.get("/v1/threads/:threadId/messages", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return listThreadMessagesRoute(
      requestDatabase(c),
      c.executionCtx,
      c.req.raw,
      parseThreadParam(c.req.param("threadId")),
      userId,
    );
  });
}
