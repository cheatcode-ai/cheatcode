import { getProject, withUserDb } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { type ProjectId, toProjectId, toUserId, type UserId } from "@cheatcode/types";
import {
  AGENT_FORWARD_ROUTES,
  InternalAgentStateDeleteBodySchema,
  type InternalAgentStateDeleteRequest,
  type InternalStateDeleteResponse,
  InternalStateDeleteResponseSchema,
} from "@cheatcode/types/internal";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AgentEnv } from "./agent-env";
import {
  agentRunForRunId,
  callAgentRun,
  sandboxForUser,
  sandboxStubForUser,
} from "./agent-routing";
import { isAgentStateDeletionAuthorized } from "./agent-state-deletion-policy";
import { readGatewayUserId } from "./tenancy";

const RUN_STATE_DELETE_CONCURRENCY = 16;
type AgentContext = Context<{ Bindings: AgentEnv }>;

export function registerAgentSystemHttpRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  const projectRoute = AGENT_FORWARD_ROUTES.project.downloadProject;
  app.on(projectRoute.method, projectRoute.path, downloadProjectArchive);
}

export async function deleteAgentUserState(
  env: AgentEnv,
  request: InternalAgentStateDeleteRequest,
): Promise<InternalStateDeleteResponse> {
  const body = InternalAgentStateDeleteBodySchema.parse(request.body);
  await assertAgentStateDeletionAuthority(env, request.userId, body);
  if (body.scope === "runs") {
    await deleteRunStates(env, request.userId, body.runIds);
    return deletedStateResult();
  }
  if (body.scope === "account") {
    const sandbox = await sandboxStubForUser(env, request.userId);
    await sandbox.deleteAccountState();
    return deletedStateResult();
  }
  const sandbox = await sandboxStubForUser(env, request.userId);
  await sandbox.cleanupProjectWorkspace({
    projectId: body.projectId,
    workspaceSlug: body.workspaceSlug,
  });
  return deletedStateResult();
}

async function assertAgentStateDeletionAuthority(
  env: AgentEnv,
  userId: UserId,
  body: z.infer<typeof InternalAgentStateDeleteBodySchema>,
): Promise<void> {
  return withUserDb(env, userId, async ({ transaction }) => {
    const isAuthorized = await transaction((transaction) =>
      isAgentStateDeletionAuthorized(transaction, userId, body),
    );
    if (!isAuthorized) {
      throw new APIError(
        409,
        "conflict_state_invalid",
        "Agent state deletion no longer matches an authoritative database generation",
        { retriable: false },
      );
    }
  });
}

async function deleteRunStates(env: AgentEnv, userId: string, runIds: string[]): Promise<void> {
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < runIds.length) {
      const runId = runIds[nextIndex];
      nextIndex += 1;
      if (!runId) {
        continue;
      }
      const response = await callAgentRun(agentRunForRunId(env, runId).deleteAll(userId));
      if (!response.ok) {
        const status = response.status;
        await response.body?.cancel().catch(() => undefined);
        throw new APIError(
          503,
          "service_maintenance_unavailable",
          "Run durable state deletion failed",
          {
            details: { status },
            retriable: true,
          },
        );
      }
      await response.body?.cancel().catch(() => undefined);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(RUN_STATE_DELETE_CONCURRENCY, runIds.length) }, worker),
  );
}

function deletedStateResult(): InternalStateDeleteResponse {
  return InternalStateDeleteResponseSchema.parse({ ok: true });
}

async function downloadProjectArchive(c: AgentContext): Promise<Response> {
  const parsedProjectId = z.string().uuid().safeParse(c.req.param("projectId"));
  if (!parsedProjectId.success) {
    throw new APIError(400, "request_path_param_invalid", "Invalid project id", {
      details: { issues: parsedProjectId.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  const userId = toUserId(readGatewayUserId(c.req.raw.headers));
  const project = await loadProject(c.env, userId, toProjectId(parsedProjectId.data));
  if (!project) {
    throw new APIError(404, "resource_project_not_found", "Project not found", {
      retriable: false,
    });
  }
  const sandbox = await sandboxForUser(c.env, userId);
  const archive = await sandbox.downloadProjectArchive({ workspaceSlug: project.workspaceSlug });
  const headers = new Headers(archive.headers);
  headers.set("Cache-Control", "private, max-age=0, no-store");
  headers.set(
    "Content-Disposition",
    downloadContentDisposition(projectArchiveFilename(project.name)),
  );
  headers.set("Content-Type", "application/zip");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(archive.body, { headers });
}

async function loadProject(env: AgentEnv, userId: UserId, projectId: ProjectId) {
  return withUserDb(env, userId, async ({ transaction }) => {
    return await transaction((tx) => getProject(tx, { projectId, userId }));
  });
}

function downloadContentDisposition(filename: string): string {
  const sanitized = Array.from(filename, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 ||
      codePoint === 127 ||
      character === "/" ||
      character === "\\" ||
      character === '"'
      ? "_"
      : character;
  })
    .slice(0, 200)
    .join("");
  const safeName = sanitized || "cheatcode-output";
  const asciiFallback = safeName.replaceAll(/[^\x20-\x7e]/gu, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

function projectArchiveFilename(projectName: string): string {
  const safeName = projectName
    .trim()
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);
  return `${safeName || "cheatcode-project"}.zip`;
}
