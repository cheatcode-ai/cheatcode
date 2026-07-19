import {
  createDb,
  findGeneratedOutput,
  getProject,
  isAgentStateDeletionAuthorized,
  loadWorkspaceTransitionOwner,
  withUserContext,
} from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError, readBoundedRequestText } from "@cheatcode/observability";
import {
  InternalAgentStateDeleteBodySchema,
  InternalStateDeleteResponseSchema,
  InternalWorkspaceReconciliationBodySchema,
  InternalWorkspaceReconciliationResponseSchema,
  internalUserStateDeletePath,
  internalUserWorkspaceReconciliationPath,
  OutputIdSchema,
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
  assertAgentInternalHostname,
  assertAgentLifecycleCapability,
  parseInternalMaintenanceJson,
  verifyAgentLifecycleRequest,
} from "./internal-maintenance";
import {
  createOutputDownloadCapability,
  OutputDownloadQuerySchema,
  verifySignedOutputDownload,
} from "./output-download";
import { GatewayUserIdSchema, readGatewayUserId } from "./tenancy";

const MAX_INTERNAL_MAINTENANCE_BODY_BYTES = 1024 * 1024;
const RUN_STATE_DELETE_CONCURRENCY = 16;
type AgentContext = Context<{ Bindings: AgentEnv }>;

export function registerAgentSystemHttpRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  app.post("/internal/users/:userId/delete-state", deleteInternalUserState);
  app.post("/internal/users/:userId/reconcile-workspaces", reconcileInternalUserWorkspaces);
  app.post("/v1/outputs/:outputId/download-url", mintOutputDownloadUrl);
  app.get("/v1/outputs/:outputId/download", downloadOutput);
  app.post("/v1/projects/:projectId/download", downloadProjectArchive);
}

async function reconcileInternalUserWorkspaces(c: AgentContext): Promise<Response> {
  if (c.env.CHEATCODE_RELEASE_GATE !== "closed") {
    throw new APIError(
      409,
      "conflict_state_invalid",
      "Workspace reconciliation requires the closed release gate",
      { retriable: false },
    );
  }
  assertAgentInternalHostname(c.req.raw);
  assertAgentLifecycleCapability(c.req.raw);
  const userId = UserId(GatewayUserIdSchema.parse(c.req.param("userId")));
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_INTERNAL_MAINTENANCE_BODY_BYTES,
    "Internal workspace reconciliation",
  );
  await verifyAgentLifecycleRequest({
    expectedPathname: internalUserWorkspaceReconciliationPath(userId),
    rawBody,
    request: c.req.raw,
    secrets: c.env,
  });
  const body = InternalWorkspaceReconciliationBodySchema.parse(
    parseInternalMaintenanceJson(rawBody),
  );
  if (c.env.CHEATCODE_RELEASE_SHA !== body.releaseSha) {
    throw new APIError(409, "conflict_state_invalid", "Agent release does not match transition", {
      details: { actualReleaseSha: c.env.CHEATCODE_RELEASE_SHA ?? null },
      retriable: false,
    });
  }
  await assertWorkspaceTransitionInventory(c.env, userId, body);
  const sandbox = await sandboxStubForUser(c.env, userId);
  const result =
    body.phase === "prepare"
      ? await sandbox.prepareWorkspaceTransition(body)
      : await sandbox.finalizeWorkspaceTransition(body);
  return c.json(InternalWorkspaceReconciliationResponseSchema.parse(result));
}

async function assertWorkspaceTransitionInventory(
  env: AgentEnv,
  userId: UserId,
  body: z.infer<typeof InternalWorkspaceReconciliationBodySchema>,
): Promise<void> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const owner = await withUserContext(db, userId, (transaction) =>
      loadWorkspaceTransitionOwner(transaction, userId),
    );
    if (!owner || !workspaceInventoryMatches(owner.projects, body.projects, body.phase)) {
      throw new APIError(
        409,
        "conflict_state_invalid",
        "Postgres workspace inventory does not match transition",
        { retriable: false },
      );
    }
  } finally {
    await close();
  }
}

function workspaceInventoryMatches(
  actual: Array<{
    canonicalWorkspaceSlug: string;
    currentWorkspaceSlug: string;
    projectId: string;
  }>,
  requested: Array<{
    canonicalWorkspaceSlug: string;
    currentWorkspaceSlug: string;
    projectId: string;
  }>,
  phase: "finalize" | "prepare",
): boolean {
  if (actual.length !== requested.length) {
    return false;
  }
  const requestedById = new Map(requested.map((project) => [project.projectId, project]));
  return actual.every((project) => {
    const request = requestedById.get(project.projectId);
    return (
      request?.canonicalWorkspaceSlug === project.canonicalWorkspaceSlug &&
      (phase === "finalize"
        ? project.currentWorkspaceSlug === request.canonicalWorkspaceSlug
        : project.currentWorkspaceSlug === request.currentWorkspaceSlug ||
          project.currentWorkspaceSlug === request.canonicalWorkspaceSlug)
    );
  });
}

async function deleteInternalUserState(c: AgentContext): Promise<Response> {
  assertAgentInternalHostname(c.req.raw);
  assertAgentLifecycleCapability(c.req.raw);
  const userId = UserId(GatewayUserIdSchema.parse(c.req.param("userId")));
  const rawBody = await readBoundedRequestText(
    c.req.raw,
    MAX_INTERNAL_MAINTENANCE_BODY_BYTES,
    "Internal maintenance request",
  );
  await verifyAgentLifecycleRequest({
    expectedPathname: internalUserStateDeletePath(userId),
    rawBody,
    request: c.req.raw,
    secrets: c.env,
  });
  const body = InternalAgentStateDeleteBodySchema.parse(parseInternalMaintenanceJson(rawBody));
  await assertAgentStateDeletionAuthority(c.env, userId, body);
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
  await sandbox.cleanupProjectWorkspace({
    projectId: body.projectId,
    workspaceSlug: body.workspaceSlug,
  });
  return deletedStateResponse(c);
}

async function assertAgentStateDeletionAuthority(
  env: AgentEnv,
  userId: UserId,
  body: z.infer<typeof InternalAgentStateDeleteBodySchema>,
): Promise<void> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const isAuthorized = await withUserContext(db, userId, (transaction) =>
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
  } finally {
    await close();
  }
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
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const output = await withUserContext(db, userId, (tx) =>
      findGeneratedOutput(tx, { outputId, userId }),
    );
    if (!output) {
      throw new APIError(404, "not_found_output", "Output not found", { retriable: false });
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
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    return await withUserContext(db, userId, (tx) => getProject(tx, { projectId, userId }));
  } finally {
    await close();
  }
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
