import { workspacePathForSlug } from "@cheatcode/db";
import {
  SandboxIdeSessionSchema,
  type SandboxIdeStartupStatus,
  SandboxIdeStartupStatusSchema,
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
  terminalDisplayCwd,
} from "./sandbox-route-support";
import { parseThreadRouteParam, readGatewayUserId } from "./tenancy";

const PRIVATE_CAPABILITY_CACHE_CONTROL = "private, no-store";
type AgentContext = Context<{ Bindings: AgentEnv }>;

export function registerSandboxPreviewHttpRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  const routes = AGENT_FORWARD_ROUTES.piped;
  app.on(routes.computerIde.method, routes.computerIde.path, openComputerIde);
  app.on(routes.computerIdeOpen.method, routes.computerIdeOpen.path, beginComputerIde);
  app.on(routes.computerIdeStatus.method, routes.computerIdeStatus.path, computerIdeStatus);
  app.on(routes.sandboxIde.method, routes.sandboxIde.path, openThreadIde);
  app.on(routes.sandboxIdeOpen.method, routes.sandboxIdeOpen.path, beginThreadIde);
  app.on(routes.sandboxIdeStatus.method, routes.sandboxIdeStatus.path, threadIdeStatus);
  app.on(routes.sandboxPreviewWake.method, routes.sandboxPreviewWake.path, wakeThreadPreview);
  app.on(routes.sandboxPreviewStatus.method, routes.sandboxPreviewStatus.path, threadPreviewStatus);
}

async function openComputerIde(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const sandbox = await sandboxForUser(c.env, userId);
  const session = await sandbox.exposeCodeServer({ workspacePath: SANDBOX_WORKSPACE_ROOT });
  return ideSessionResponse(c, session);
}

async function beginComputerIde(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const sandbox = await sandboxForUser(c.env, userId);
  const status = await sandbox.beginCodeServerStartup();
  return ideStartupResponse(c, status, computerIdeStatusPath(status.operationId));
}

async function computerIdeStatus(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const sandbox = await sandboxForUser(c.env, userId);
  const status = await sandbox.codeServerStartupStatus(c.req.param("operationId") ?? "");
  return ideStatusResponse(c, status);
}

async function openThreadIde(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  const project = await requireWritableThreadProject(c.env, userId, threadId);
  const sandbox = await sandboxForUser(c.env, userId);
  const workspacePath = project
    ? workspacePathForSlug(project.workspaceSlug)
    : SANDBOX_WORKSPACE_ROOT;
  const session = await sandbox.exposeCodeServer({ workspacePath });
  return ideSessionResponse(c, session);
}

async function beginThreadIde(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  await requireWritableThreadProject(c.env, userId, threadId);
  const sandbox = await sandboxForUser(c.env, userId);
  const status = await sandbox.beginCodeServerStartup();
  return ideStartupResponse(c, status, threadIdeStatusPath(threadId, status.operationId));
}

async function threadIdeStatus(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  parseThreadRouteParam(c.req.param("threadId") ?? "");
  const sandbox = await sandboxForUser(c.env, userId);
  const status = await sandbox.codeServerStartupStatus(c.req.param("operationId") ?? "");
  return ideStatusResponse(c, status);
}

async function wakeThreadPreview(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  const project = await requireWritableThreadProject(c.env, userId, threadId);
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
  const project = await requireWritableThreadProject(c.env, userId, threadId);
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

function ideStartupResponse(
  c: AgentContext,
  status: SandboxIdeStartupStatus,
  statusPath: string,
): Response {
  c.header("Cache-Control", PRIVATE_CAPABILITY_CACHE_CONTROL);
  c.header("Location", statusPath);
  const parsed = SandboxIdeStartupStatusSchema.parse(status);
  if (parsed.phase === "ready") return c.json(parsed);
  c.header("Retry-After", "1");
  return c.json(parsed, 202);
}

function ideStatusResponse(c: AgentContext, status: SandboxIdeStartupStatus): Response {
  c.header("Cache-Control", PRIVATE_CAPABILITY_CACHE_CONTROL);
  return c.json(SandboxIdeStartupStatusSchema.parse(status));
}

function computerIdeStatusPath(operationId: string): string {
  return `/v1/computer/ide/status/${encodeURIComponent(operationId)}`;
}

function threadIdeStatusPath(threadId: string, operationId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}/sandbox/ide/status/${encodeURIComponent(operationId)}`;
}
