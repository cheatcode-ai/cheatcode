import { workspacePathForSlug } from "@cheatcode/db";
import { readJsonRequest } from "@cheatcode/observability";
import { resolveProjectWorkspacePath } from "@cheatcode/tools-code";
import {
  SandboxConsoleQuerySchema,
  SandboxConsoleSnapshotSchema,
  SandboxFilePathSchema,
  SandboxTerminalCommandSchema,
  SandboxTerminalContextSchema,
  SandboxTerminalResultSchema,
} from "@cheatcode/types";
import type { Context, Hono } from "hono";
import type { z } from "zod";
import type { AgentEnv } from "./agent-env";
import { requireWritableThreadProject, sandboxForUser } from "./agent-routing";
import {
  extractTerminalCwd,
  SANDBOX_WORKSPACE_ROOT,
  TERMINAL_DISPLAY_WORKSPACE,
  terminalDisplayCwd,
  terminalProjectForThread,
  withTerminalCwdMarker,
} from "./sandbox-route-helpers";
import { parseThreadRouteParam, readGatewayUserId } from "./tenancy";

const AgentSandboxTerminalResultSchema = SandboxTerminalResultSchema.extend({
  cwd: SandboxFilePathSchema.optional(),
});
const MAX_SANDBOX_TERMINAL_REQUEST_BYTES = 16 * 1024;
type AgentContext = Context<{ Bindings: AgentEnv }>;
type TerminalCommand = z.infer<typeof SandboxTerminalCommandSchema>;

export function registerSandboxTerminalHttpRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  app.get("/v1/threads/:threadId/sandbox/terminal/context", threadTerminalContext);
  app.get("/v1/computer/terminal/context", computerTerminalContext);
  app.post("/v1/threads/:threadId/sandbox/terminal", executeThreadTerminalCommand);
  app.post("/v1/computer/terminal", executeComputerTerminalCommand);
  app.get("/v1/threads/:threadId/sandbox/console", readThreadConsole);
}

async function threadTerminalContext(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  const project = await terminalProjectForThread(c.env, userId, threadId);
  const sandbox = await sandboxForUser(c.env, userId);
  const cwd = project ? workspacePathForSlug(project.workspaceSlug) : SANDBOX_WORKSPACE_ROOT;
  return c.json(
    SandboxTerminalContextSchema.parse({
      cwd,
      displayCwd: terminalDisplayCwd(cwd),
      displayWorkspacePath: TERMINAL_DISPLAY_WORKSPACE,
      host: project ? await sandbox.runtimeSandboxId() : threadId.slice(0, 12),
    }),
  );
}

async function computerTerminalContext(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const sandbox = await sandboxForUser(c.env, userId);
  return c.json(
    SandboxTerminalContextSchema.parse({
      cwd: SANDBOX_WORKSPACE_ROOT,
      displayCwd: terminalDisplayCwd(SANDBOX_WORKSPACE_ROOT),
      displayWorkspacePath: TERMINAL_DISPLAY_WORKSPACE,
      host: await sandbox.runtimeSandboxId(),
    }),
  );
}

async function executeThreadTerminalCommand(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  const body = await readTerminalCommand(c);
  await requireWritableThreadProject(c.env, userId, threadId);
  const project = await terminalProjectForThread(c.env, userId, threadId);
  const sandbox = await sandboxForUser(c.env, userId);
  const workspaceDir = project
    ? workspacePathForSlug(project.workspaceSlug)
    : SANDBOX_WORKSPACE_ROOT;
  return executeTerminalCommand(
    c,
    sandbox,
    body,
    resolveProjectWorkspacePath(body.cwd, workspaceDir),
  );
}

async function executeComputerTerminalCommand(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const body = await readTerminalCommand(c);
  const sandbox = await sandboxForUser(c.env, userId);
  return executeTerminalCommand(c, sandbox, body, body.cwd);
}

async function executeTerminalCommand(
  c: AgentContext,
  sandbox: Awaited<ReturnType<typeof sandboxForUser>>,
  body: TerminalCommand,
  cwd: string | undefined,
): Promise<Response> {
  const cwdMarker = `__CHEATCODE_CWD_${crypto.randomUUID()}__`;
  const result = await sandbox.exec({
    command: ["sh", "-lc", withTerminalCwdMarker(body.command, cwdMarker)],
    cwd,
    timeoutMs: body.timeoutMs,
  });
  const output = extractTerminalCwd(result.stdout, cwdMarker);
  return c.json(
    AgentSandboxTerminalResultSchema.parse({
      ...result,
      command: body.command,
      cwd: output.cwd,
      stdout: output.stdout,
    }),
  );
}

async function readThreadConsole(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  const query = SandboxConsoleQuerySchema.parse({
    lastPid: c.req.query("lastPid") ?? undefined,
    processId: c.req.query("processId") ?? undefined,
    stderrCursor: c.req.query("stderrCursor") ?? undefined,
    stdoutCursor: c.req.query("stdoutCursor") ?? undefined,
    tail: c.req.query("tail") ?? undefined,
  });
  const project = await terminalProjectForThread(c.env, userId, threadId);
  const sandbox = await sandboxForUser(c.env, userId);
  const snapshot = await sandbox.readDevServerLogs(
    project ? { ...query, processId: `app-preview:${project.workspaceSlug}` } : query,
  );
  return c.json(SandboxConsoleSnapshotSchema.parse(snapshot));
}

async function readTerminalCommand(c: AgentContext): Promise<TerminalCommand> {
  return SandboxTerminalCommandSchema.parse(
    await readJsonRequest(
      c.req.raw,
      MAX_SANDBOX_TERMINAL_REQUEST_BYTES,
      "Sandbox terminal request",
    ),
  );
}
