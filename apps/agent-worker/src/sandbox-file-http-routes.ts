import { workspacePathForSlug } from "@cheatcode/db";
import { readJsonRequest } from "@cheatcode/observability";
import { resolveProjectWorkspacePath } from "@cheatcode/tools-code";
import {
  SandboxFileListSchema,
  SandboxFilePathSchema,
  SandboxFilePreviewSchema,
  SandboxFileSchema,
  SandboxFileWriteSchema,
  UpdateSandboxPathFileSchema,
} from "@cheatcode/types";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AgentEnv } from "./agent-env";
import { requireWritableThreadProject, sandboxForUser } from "./agent-routing";
import { SANDBOX_WORKSPACE_ROOT, terminalProjectForThread } from "./sandbox-route-helpers";
import { parseThreadRouteParam, readGatewayUserId } from "./tenancy";

const DEFAULT_SANDBOX_FILE_LIST_ROOT = "/workspace";
const MAX_SANDBOX_FILE_WRITE_REQUEST_BYTES = 10 * 1024 * 1024;
const QueryBooleanSchema = z.enum(["false", "true"]).transform((value) => value === "true");
const SandboxFileListQuerySchema = z
  .object({
    includeHidden: QueryBooleanSchema.default(false),
    path: SandboxFilePathSchema.default(DEFAULT_SANDBOX_FILE_LIST_ROOT),
    recursive: QueryBooleanSchema.default(true),
  })
  .strict();
const SandboxReadEncodingQuerySchema = z.enum(["utf8", "base64"]).optional();

type AgentContext = Context<{ Bindings: AgentEnv }>;

export function registerSandboxFileHttpRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  app.get("/v1/threads/:threadId/sandbox/files", listSandboxFiles);
  app.get("/v1/threads/:threadId/sandbox/file", readSandboxFile);
  app.get("/v1/threads/:threadId/sandbox/file-preview", previewSandboxFile);
  app.patch("/v1/threads/:threadId/sandbox/file", writeSandboxFile);
}

async function listSandboxFiles(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  const query = SandboxFileListQuerySchema.parse({
    includeHidden: c.req.query("includeHidden") ?? undefined,
    path: c.req.query("path") ?? undefined,
    recursive: c.req.query("recursive") ?? undefined,
  });
  const scoped = await scopedThreadSandboxPath(c.env, userId, threadId, query.path);
  const result = await scoped.sandbox.listFiles({ ...query, path: scoped.path });
  return c.json(SandboxFileListSchema.parse(result));
}

async function readSandboxFile(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  const path = SandboxFilePathSchema.parse(c.req.query("path"));
  const encoding = SandboxReadEncodingQuerySchema.parse(c.req.query("encoding") ?? undefined);
  const scoped = await scopedThreadSandboxPath(c.env, userId, threadId, path);
  const file = await scoped.sandbox.readFile({
    path: scoped.path,
    ...(encoding ? { encoding } : {}),
  });
  return c.json(SandboxFileSchema.parse(file));
}

async function previewSandboxFile(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  const path = SandboxFilePathSchema.parse(c.req.query("path"));
  const scoped = await scopedThreadSandboxPath(c.env, userId, threadId, path);
  const preview = await scoped.sandbox.previewFile({ path: scoped.path });
  return c.json(SandboxFilePreviewSchema.parse(preview));
}

async function writeSandboxFile(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  const body = UpdateSandboxPathFileSchema.parse(
    await readJsonRequest(c.req.raw, MAX_SANDBOX_FILE_WRITE_REQUEST_BYTES, "Sandbox file write"),
  );
  await requireWritableThreadProject(c.env, userId, threadId);
  const scoped = await scopedThreadSandboxPath(c.env, userId, threadId, body.path);
  const result = await scoped.sandbox.writeFile({
    content: body.content,
    encoding: body.encoding,
    path: scoped.path,
  });
  return c.json(SandboxFileWriteSchema.parse(result));
}

async function scopedThreadSandboxPath(
  env: AgentEnv,
  userId: string,
  threadId: string,
  path: string,
): Promise<{
  path: string;
  sandbox: Awaited<ReturnType<typeof sandboxForUser>>;
}> {
  const project = await terminalProjectForThread(env, userId, threadId);
  const workspaceDir = project
    ? workspacePathForSlug(project.workspaceSlug)
    : SANDBOX_WORKSPACE_ROOT;
  return {
    path: resolveProjectWorkspacePath(path, workspaceDir),
    sandbox: await sandboxForUser(env, userId),
  };
}
