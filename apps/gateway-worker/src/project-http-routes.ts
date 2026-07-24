import { forwardAgentRequest } from "./agent-forwarding";
import { authenticate } from "./authenticate";
import type { GatewayApp } from "./gateway-env";
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
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/projects");
    return listProjectsRoute(c.env, c.executionCtx, c.req.raw, userId);
  });
  app.post("/v1/projects", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/projects");
    return createProjectRoute(c.env, c.executionCtx, c.req.raw, userId);
  });
}

function registerProjectItemRoutes(app: GatewayApp): void {
  app.get("/v1/projects/:projectId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/projects/:projectId");
    return getProjectRoute(
      c.env,
      c.executionCtx,
      parseProjectParam(c.req.param("projectId")),
      userId,
    );
  });
  app.patch("/v1/projects/:projectId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "PATCH /v1/projects/:projectId");
    return updateProjectRoute(
      c.env,
      c.executionCtx,
      c.req.raw,
      parseProjectParam(c.req.param("projectId")),
      userId,
    );
  });
  app.delete("/v1/projects/:projectId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "DELETE /v1/projects/:projectId");
    return deleteProjectRoute(
      c.env,
      c.executionCtx,
      parseProjectParam(c.req.param("projectId")),
      userId,
    );
  });
}

function registerProjectRelatedRoutes(app: GatewayApp): void {
  app.get("/v1/projects/:projectId/files", (c) =>
    forwardAgentRequest(c, "GET /v1/projects/:projectId/files"),
  );
  app.post("/v1/projects/:projectId/files", (c) =>
    forwardAgentRequest(c, "POST /v1/projects/:projectId/files"),
  );
  app.post("/v1/projects/:projectId/download", (c) =>
    forwardAgentRequest(c, "POST /v1/projects/:projectId/download"),
  );
  app.get("/v1/projects/:projectId/threads", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/projects/:projectId/threads");
    return listProjectThreadsRoute(
      c.env,
      c.executionCtx,
      c.req.raw,
      parseProjectParam(c.req.param("projectId")),
      userId,
    );
  });
}

function registerThreadRoutes(app: GatewayApp): void {
  app.post("/v1/threads", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/threads");
    return createChatRoute(c.env, c.executionCtx, c.req.raw, userId);
  });
  app.get("/v1/threads/:threadId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/threads/:threadId");
    return getThreadRoute(c.env, c.executionCtx, parseThreadParam(c.req.param("threadId")), userId);
  });
  app.patch("/v1/threads/:threadId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "PATCH /v1/threads/:threadId");
    return updateThreadRoute(
      c.env,
      c.executionCtx,
      c.req.raw,
      parseThreadParam(c.req.param("threadId")),
      userId,
    );
  });
  app.delete("/v1/threads/:threadId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "DELETE /v1/threads/:threadId");
    return deleteThreadRoute(
      c.env,
      c.executionCtx,
      parseThreadParam(c.req.param("threadId")),
      userId,
    );
  });
  app.get("/v1/threads/:threadId/messages", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/threads/:threadId/messages");
    return listThreadMessagesRoute(
      c.env,
      c.executionCtx,
      c.req.raw,
      parseThreadParam(c.req.param("threadId")),
      userId,
    );
  });
}
