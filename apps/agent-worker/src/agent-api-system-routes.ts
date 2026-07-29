import { findGeneratedOutput, getProject, withUserDb } from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import { OutputIdSchema, ProjectId, UserId } from "@cheatcode/types";
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
import {
  createOutputDownloadCapability,
  OutputDownloadQuerySchema,
  verifySignedOutputDownload,
} from "./output-download";
import { readGatewayUserId } from "./tenancy";

const RUN_STATE_DELETE_CONCURRENCY = 16;
type AgentContext = Context<{ Bindings: AgentEnv }>;

export function registerAgentSystemHttpRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  const coreRoutes = AGENT_FORWARD_ROUTES.core;
  const projectRoute = AGENT_FORWARD_ROUTES.project.downloadProject;
  app.on(
    coreRoutes.mintOutputDownloadUrl.method,
    coreRoutes.mintOutputDownloadUrl.path,
    mintOutputDownloadUrl,
  );
  app.on(coreRoutes.downloadOutput.method, coreRoutes.downloadOutput.path, downloadOutput);
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
        throw new APIError(503, "unavailable_maintenance", "Run durable state deletion failed", {
          details: { status },
          retriable: true,
        });
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

async function mintOutputDownloadUrl(c: AgentContext): Promise<Response> {
  const outputId = parseOutputId(c.req.param("outputId"));
  const userId = UserId(readGatewayUserId(c.req.raw.headers));
  const output = await findDownloadableOutput(c.env, outputId, userId);
  if (!(await c.env.R2_OUTPUTS.head(output.r2Key))) {
    throw new APIError(404, "not_found_output", "Output object not found", { retriable: false });
  }
  const capability = await createOutputDownloadCapability({
    baseUrl: outputDownloadBaseUrl(c.env),
    outputId,
    secret: await resolveOutputSigningSecret(c.env.OUTPUT_DOWNLOAD_SIGNING_SECRET),
    userId,
  });
  const response = c.json(capability);
  response.headers.set("Cache-Control", "private, max-age=0, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function downloadOutput(c: AgentContext): Promise<Response> {
  const outputId = parseOutputId(c.req.param("outputId"));
  const query = parseOutputDownloadQuery(c);
  const isValid = await verifySignedOutputDownload({
    expires: query.expires,
    outputId,
    secret: await resolveOutputSigningSecret(c.env.OUTPUT_DOWNLOAD_SIGNING_SECRET),
    signature: query.sig,
    userId: query.userId,
  });
  if (!isValid) {
    throw new APIError(403, "permission_denied", "Invalid or expired output download URL", {
      retriable: false,
    });
  }
  const output = await findDownloadableOutput(c.env, outputId, query.userId);
  const object = await c.env.R2_OUTPUTS.get(output.r2Key);
  if (!object?.body) {
    throw new APIError(404, "not_found_output", "Output object not found", { retriable: false });
  }
  return new Response(object.body, {
    headers: {
      "Cache-Control": "private, max-age=0, no-store",
      "Content-Disposition": downloadContentDisposition(output.filename),
      "Content-Type": output.mimeType,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function parseOutputId(value: string | undefined): string {
  const parsed = OutputIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", "Invalid output id", {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  return parsed.data;
}

function parseOutputDownloadQuery(c: AgentContext): z.infer<typeof OutputDownloadQuerySchema> {
  const parsed = OutputDownloadQuerySchema.safeParse({
    expires: c.req.query("expires"),
    sig: c.req.query("sig"),
    userId: c.req.query("userId"),
  });
  if (!parsed.success) {
    throw new APIError(400, "invalid_query_param", "Invalid output download signature", {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  return parsed.data;
}

async function findDownloadableOutput(env: AgentEnv, outputId: string, userId: UserId) {
  return withUserDb(env, userId, async ({ transaction }) => {
    const output = await transaction((tx) => findGeneratedOutput(tx, { outputId, userId }));
    if (!output) {
      throw new APIError(404, "not_found_output", "Output not found", { retriable: false });
    }
    return output;
  });
}

async function resolveOutputSigningSecret(secret: WorkerSecret): Promise<string | undefined> {
  try {
    return await resolveWorkerSecret(secret);
  } catch {
    throw new APIError(503, "unavailable_maintenance", "Output signing secret is unavailable", {
      retriable: true,
    });
  }
}

function outputDownloadBaseUrl(env: AgentEnv): string | undefined {
  const previewHostname = env.PREVIEW_HOSTNAME.trim();
  if (previewHostname === "localhost:8787" || previewHostname === "127.0.0.1:8787") {
    return `http://${previewHostname}`;
  }
  return env.OUTPUT_DOWNLOAD_BASE_URL;
}

async function downloadProjectArchive(c: AgentContext): Promise<Response> {
  const parsedProjectId = z.string().uuid().safeParse(c.req.param("projectId"));
  if (!parsedProjectId.success) {
    throw new APIError(400, "invalid_path_param", "Invalid project id", {
      details: { issues: parsedProjectId.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  const userId = UserId(readGatewayUserId(c.req.raw.headers));
  const project = await loadProject(c.env, userId, ProjectId(parsedProjectId.data));
  if (!project) {
    throw new APIError(404, "not_found_project", "Project not found", { retriable: false });
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
