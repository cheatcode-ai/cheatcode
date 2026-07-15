import { createDb, findGeneratedOutputOwner, getProject, withUserContext } from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError, readBoundedRequestText } from "@cheatcode/observability";
import {
  InternalAgentStateDeleteBodySchema,
  InternalStateDeleteResponseSchema,
  ProjectId,
  UserId,
} from "@cheatcode/types";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AgentEnv } from "./agent-env";
import {
  agentRunForRunId,
  fetchAgentRun,
  sandboxForUser,
  sandboxStubForUser,
} from "./agent-routing";
import {
  parseInternalMaintenanceJson,
  verifyAgentMaintenanceRequest,
} from "./internal-maintenance";
import { resolveLocalPreviewOrigin } from "./local-preview";
import {
  OutputDownloadQuerySchema,
  OutputIdSchema,
  verifySignedOutputDownload,
} from "./output-download";
import { GatewayUserIdSchema, readGatewayUserId } from "./tenancy";

const MAX_INTERNAL_MAINTENANCE_BODY_BYTES = 1024 * 1024;
const RUN_STATE_DELETE_CONCURRENCY = 16;
type AgentContext = Context<{ Bindings: AgentEnv }>;

export function registerAgentSystemHttpRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  app.get("/__internal/local-preview-origin", resolveInternalLocalPreviewOrigin);
  app.post("/internal/users/:userId/delete-state", deleteInternalUserState);
  app.get("/v1/outputs/:outputId/download", downloadOutput);
  app.post("/v1/projects/:projectId/download", downloadProjectArchive);
}

async function resolveInternalLocalPreviewOrigin(c: AgentContext): Promise<Response> {
  const previewUrl = c.req.header("X-Cheatcode-Local-Preview-Url");
  const previewHost = c.req.header("X-Cheatcode-Local-Preview-Host");
  if (!previewUrl || !previewHost) {
    throw new APIError(400, "invalid_request_body", "Missing local preview origin headers", {
      retriable: false,
    });
  }
  const headers = localPreviewHeaders(c, previewHost);
  const resolved = await resolveLocalPreviewOrigin(new Request(previewUrl, { headers }), c.env);
  if (!resolved) {
    throw new APIError(404, "invalid_request_body", "Local preview origin not found", {
      retriable: false,
    });
  }
  if (resolved.authorization.fromQuery) {
    throw new APIError(
      400,
      "invalid_request_body",
      "WebSocket preview requires an established session",
      { retriable: false },
    );
  }
  return c.json({
    originalHost: resolved.originalHost,
    signed: resolved.origin.signed,
    token: resolved.origin.token,
    url: resolved.origin.url,
  });
}

function localPreviewHeaders(c: AgentContext, previewHost: string): Headers {
  const headers = new Headers({ Host: previewHost });
  copyHeader(c, headers, "X-Cheatcode-Local-Preview-Cookie", "Cookie");
  copyHeader(c, headers, "Origin", "Origin");
  copyHeader(
    c,
    headers,
    "X-Cheatcode-Local-Preview-Client-Host",
    "X-Cheatcode-Local-Preview-Client-Host",
  );
  return headers;
}

function copyHeader(
  c: AgentContext,
  target: Headers,
  sourceName: string,
  targetName: string,
): void {
  const value = c.req.header(sourceName);
  if (value) {
    target.set(targetName, value);
  }
}

async function deleteInternalUserState(c: AgentContext): Promise<Response> {
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_INTERNAL_MAINTENANCE_BODY_BYTES,
    "Internal maintenance request",
  );
  await verifyAgentMaintenanceRequest({
    rawBody,
    request: c.req.raw,
    secret: c.env.INTERNAL_MAINTENANCE_SECRET,
  });
  const userId = UserId(GatewayUserIdSchema.parse(c.req.param("userId")));
  const body = InternalAgentStateDeleteBodySchema.parse(parseInternalMaintenanceJson(rawBody));
  if (body.scope === "runs") {
    await deleteRunStates(c.env, userId, body.runIds);
    return deletedStateResponse(c);
  }
  if (body.scope === "account") {
    const sandbox = await sandboxStubForUser(c.env, userId);
    await sandbox.deleteAccountState();
    return deletedStateResponse(c);
  }
  const sandbox = await sandboxForUser(c.env, userId);
  await sandbox.cleanupProjectWorkspace({ workspaceSlug: body.workspaceSlug });
  return deletedStateResponse(c);
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
      const response = await fetchAgentRun(
        agentRunForRunId(env, runId),
        "https://agent-run.internal/delete-all",
        { headers: { "X-Cheatcode-User-Id": userId }, method: "POST" },
      );
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

function deletedStateResponse(c: AgentContext): Response {
  return c.json(InternalStateDeleteResponseSchema.parse({ ok: true }));
}

async function downloadOutput(c: AgentContext): Promise<Response> {
  const outputId = parseOutputId(c.req.param("outputId"));
  const query = parseOutputDownloadQuery(c);
  const isValid = await verifySignedOutputDownload({
    expires: query.expires,
    outputId,
    secret: await resolveOutputSigningSecret(c.env.OUTPUT_DOWNLOAD_SIGNING_SECRET),
    signature: query.sig,
  });
  if (!isValid) {
    throw new APIError(403, "permission_denied", "Invalid or expired output download URL", {
      retriable: false,
    });
  }
  const output = await findDownloadableOutput(c.env, outputId);
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
  });
  if (!parsed.success) {
    throw new APIError(400, "invalid_query_param", "Invalid output download signature", {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  return parsed.data;
}

async function findDownloadableOutput(env: AgentEnv, outputId: string) {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const output = await findGeneratedOutputOwner(db, outputId);
    if (!output) {
      throw new APIError(404, "not_found_output", "Output not found", { retriable: false });
    }
    if (output.expiresAt.getTime() < Date.now()) {
      throw new APIError(410, "gone_output_expired", "Output download has expired", {
        retriable: false,
      });
    }
    return output;
  } finally {
    await close();
  }
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
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    return await withUserContext(db, userId, (tx) => getProject(tx, { projectId, userId }));
  } finally {
    await close();
  }
}

function downloadContentDisposition(filename: string): string {
  const safeName = Array.from(filename, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 || character === "\\" || character === '"'
      ? "_"
      : character;
  }).join("");
  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function projectArchiveFilename(projectName: string): string {
  const safeName = projectName
    .trim()
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);
  return `${safeName || "cheatcode-project"}.zip`;
}
