import { workspacePathForSlug } from "@cheatcode/db";
import {
  SandboxIdeSessionSchema,
  SandboxPreviewStatusSchema,
  SandboxPreviewWakeSchema,
} from "@cheatcode/types/api";
import { AGENT_FORWARD_ROUTES } from "@cheatcode/types/internal";
import type { Context, Hono } from "hono";
import type { AgentEnv } from "./agent-env";
import { requireWritableThreadProject, sandboxForUser } from "./agent-routing";
import {
  readSandboxStateCache,
  SANDBOX_WORKSPACE_ROOT,
  selectInitialCodeServerFile,
  terminalDisplayCwd,
  terminalProjectForThread,
} from "./sandbox-route-support";
import { parseThreadRouteParam, readGatewayUserId } from "./tenancy";

const PRIVATE_CAPABILITY_CACHE_CONTROL = "private, no-store";
type AgentContext = Context<{ Bindings: AgentEnv }>;

export function registerSandboxPreviewHttpRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  const routes = AGENT_FORWARD_ROUTES.piped;
  app.on(routes.computerIde.method, routes.computerIde.path, openComputerIde);
  app.on(routes.sandboxIde.method, routes.sandboxIde.path, openThreadIde);
  app.on(routes.sandboxPreviewWake.method, routes.sandboxPreviewWake.path, wakeThreadPreview);
  app.on(routes.sandboxPreviewStatus.method, routes.sandboxPreviewStatus.path, threadPreviewStatus);
}

async function openComputerIde(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const sandbox = await sandboxForUser(c.env, userId);
  const session = await sandbox.exposeCodeServer({ workspacePath: SANDBOX_WORKSPACE_ROOT });
  return ideSessionResponse(c, session);
}

async function openThreadIde(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  await requireWritableThreadProject(c.env, userId, threadId);
  const project = await terminalProjectForThread(c.env, userId, threadId);
  const sandbox = await sandboxForUser(c.env, userId);
  const workspacePath = project
    ? workspacePathForSlug(project.workspaceSlug)
    : SANDBOX_WORKSPACE_ROOT;
  const initialFilePath = project
    ? selectInitialCodeServerFile(
        (await sandbox.listFiles({ includeHidden: false, path: workspacePath, recursive: true }))
          .files,
        workspacePath,
      )
    : undefined;
  const session = await sandbox.exposeCodeServer({
    ...(initialFilePath ? { initialFilePath } : {}),
    workspacePath,
  });
  return ideSessionResponse(c, session);
}

async function wakeThreadPreview(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  await requireWritableThreadProject(c.env, userId, threadId);
  const project = await terminalProjectForThread(c.env, userId, threadId);
  const sandbox = await sandboxForUser(c.env, userId);
  const result = await sandbox.wakePreview({
    ...(project ? { workspaceSlug: project.workspaceSlug } : {}),
  });
  c.header("Cache-Control", PRIVATE_CAPABILITY_CACHE_CONTROL);
  return c.json(SandboxPreviewWakeSchema.parse(result));
}

async function threadPreviewStatus(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  await requireWritableThreadProject(c.env, userId, threadId);
  const project = await terminalProjectForThread(c.env, userId, threadId);
  const sandbox = await sandboxForUser(c.env, userId);
  if (project) {
    const status = await sandbox.projectPreviewStatus({ workspaceSlug: project.workspaceSlug });
    return c.json(SandboxPreviewStatusSchema.parse(status));
  }
  const daytonaId = await sandbox.existingDaytonaId();
  const cached = daytonaId ? await readSandboxStateCache(c.env, daytonaId) : null;
  const runtime = cached ?? (await sandbox.sandboxRuntimeState());
  return c.json(
    SandboxPreviewStatusSchema.parse({
      running: runtime.state === "started",
      state: runtime.state,
      ...(cached?.updatedAt ? { updatedAt: cached.updatedAt } : {}),
    }),
  );
}

function ideSessionResponse(
  c: AgentContext,
  session: { expiresAt: string; url: string; workspacePath: string },
): Response {
  c.header("Cache-Control", PRIVATE_CAPABILITY_CACHE_CONTROL);
  return c.json(
    SandboxIdeSessionSchema.parse({
      ...session,
      displayWorkspacePath: terminalDisplayCwd(session.workspacePath),
    }),
  );
}
