import {
  createAgentRunForThread,
  createDb,
  createThreadMessage,
  findGeneratedOutputOwner,
  getProject,
  getThread,
  withUserContext,
  workspacePathForSlug,
} from "@cheatcode/db";
import { AgentWorkerEnvSchema, type WorkerSecret } from "@cheatcode/env";
import {
  type AnalyticsBindings,
  APIError,
  emitErrorEvent,
  emitPerformanceMetric,
  toAPIError,
  withErrorHandler,
} from "@cheatcode/observability";
import {
  ApprovalDecisionRequestSchema,
  ProjectId,
  SandboxConsoleQuerySchema,
  SandboxConsoleSnapshotSchema,
  type SandboxFileEntry,
  SandboxFileKeySchema,
  SandboxFileListSchema,
  SandboxFilePathSchema,
  SandboxFilePreviewSchema,
  SandboxFileSchema,
  SandboxFileWriteSchema,
  SandboxIdeSessionSchema,
  SandboxPreviewStatusSchema,
  SandboxPreviewWakeSchema,
  SandboxTerminalCommandSchema,
  SandboxTerminalContextSchema,
  SandboxTerminalResultSchema,
  ThreadId,
  UpdateSandboxFileSchema,
  UpdateSandboxPathFileSchema,
  UserId,
} from "@cheatcode/types";
import { Hono } from "hono";
import { z } from "zod";
import {
  activeRunForThreadRoute,
  agentRunForRunId,
  consumeTakeoverState,
  fetchAgentRun,
  requireWritableThreadProject,
  runEntitlementPolicy,
  runForRoute,
  sandboxForProject,
  sandboxForThread,
  sandboxForUser,
  saveTakeoverState,
  startAgentRun,
  startLegacyThreadRun,
  syncSandboxQuotaPeriod,
  withRunLocation,
} from "./agent-routing";
import { AgentRun } from "./durable-objects/agent-run";
import { ProjectSandbox } from "./durable-objects/project-sandbox";
import { formatAgentRouteError } from "./error-handling";
import {
  parseInternalMaintenanceJson,
  verifyAgentMaintenanceRequest,
} from "./internal-maintenance";
import { resolveLocalPreviewOrigin, tryHandleLocalPreviewRequest } from "./local-preview";
import {
  OutputDownloadQuerySchema,
  OutputIdSchema,
  verifySignedOutputDownload,
} from "./output-download";
import { loadRunPersonalization } from "./run-personalization";
import { parseCreateRunRequestBody } from "./run-request";
import {
  GatewayUserIdSchema,
  isUuidRouteParam,
  parseRunRouteParam,
  parseThreadRouteParam,
  readGatewayUserId,
  userSandboxName,
} from "./tenancy";

export { AgentRun, ProjectSandbox };

const AgentSandboxTerminalResultSchema = SandboxTerminalResultSchema.extend({
  cwd: SandboxFilePathSchema.optional(),
});

export interface AgentEnv extends AnalyticsBindings {
  AGENT_RUN: DurableObjectNamespace<AgentRun>;
  COMPOSIO_API_KEY?: WorkerSecret;
  DAYTONA_API_KEY: WorkerSecret;
  DAYTONA_API_URL: string;
  DAYTONA_ORG_ID?: string;
  DAYTONA_TARGET: string;
  HYPERDRIVE: Hyperdrive;
  INTERNAL_MAINTENANCE_SECRET?: WorkerSecret;
  OUTPUT_DOWNLOAD_BASE_URL?: string;
  OUTPUT_DOWNLOAD_SIGNING_SECRET: string;
  PREVIEW_TOKEN_SECRET: WorkerSecret;
  PREVIEW_HOSTNAME?: string;
  PROJECT_SANDBOX: DurableObjectNamespace<ProjectSandbox>;
  QUOTA_TRACKER?: DurableObjectNamespace;
  R2_AUDIT: R2Bucket;
  R2_OUTPUTS: R2Bucket;
  R2_OUTPUTS_BUCKET_NAME?: string;
  // Webhook-fed sandbox lifecycle cache (Daytona sandbox.state.updated), keyed by sandbox UUID.
  // Optional so the preview-status endpoint falls back to a live read when unbound.
  SANDBOX_STATE?: KVNamespace;
}

const DEFAULT_PREVIEW_HOSTNAME = "trycheatcode.com";
const DEFAULT_AGENT_NAME = "general";
const START_VNC_SCRIPT = "/opt/cheatcode/start-vnc.sh";
const TAKEOVER_PORT = 6080;
const TAKEOVER_TTL_MS = 15 * 60 * 1000;
const DEFAULT_SANDBOX_FILE_LIST_ROOT = "/workspace";
const SANDBOX_WORKSPACE_ROOT = "/workspace";
const TERMINAL_DISPLAY_WORKSPACE = "/home/user/computer";

const PreviewHostnameSchema = z.string().trim().min(1).max(255).default(DEFAULT_PREVIEW_HOSTNAME);
const QueryBooleanSchema = z.enum(["false", "true"]).transform((value) => value === "true");
const ResumeTakeoverBodySchema = z
  .object({
    resumeToken: z.string().min(32).max(200),
  })
  .strict();
const SandboxFileListQuerySchema = z
  .object({
    includeHidden: QueryBooleanSchema.default(false),
    path: SandboxFilePathSchema.default(DEFAULT_SANDBOX_FILE_LIST_ROOT),
    recursive: QueryBooleanSchema.default(true),
  })
  .strict();
const SandboxReadEncodingQuerySchema = z.enum(["utf8", "base64"]).optional();
const InternalUserStateDeleteBodySchema = z
  .object({
    // Per project: id, plus the workspace slug so per-project cleanup can target /workspace/<slug>
    // in the shared per-user sandbox. `scope` distinguishes the two callers:
    //   - "project": one project deleted → reclaim ONLY its folder; never destroy the sandbox.
    //   - "account": user deleted → tear the whole per-user sandbox down exactly once.
    projects: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            workspaceSlug: z.string().min(1).max(200).optional(),
          })
          .strict(),
      )
      .max(1_000),
    runIds: z.array(z.string().uuid()).max(10_000),
    scope: z.enum(["project", "account"]).default("account"),
  })
  .strict();
const InternalUserStateDeleteResponseSchema = z
  .object({
    ok: z.literal(true),
    projectStatesDeleted: z.number().int().nonnegative(),
    projectVolumesDeleted: z.number().int().nonnegative(),
    runStatesDeleted: z.number().int().nonnegative(),
  })
  .strict();
const TakeoverResponseSchema = z
  .object({
    resumeToken: z.string().min(32).max(200),
    vncUrl: z.string().url(),
  })
  .strict();
const SANDBOX_FILE_PATHS = {
  "app-page": "/workspace/app/src/app/page.tsx",
} as const satisfies Record<z.infer<typeof SandboxFileKeySchema>, string>;

export const agentApp = new Hono<{ Bindings: AgentEnv }>();

const ApprovalIdParamSchema = z.string().uuid();

function parseApprovalRouteParam(value: string): string {
  const parsed = ApprovalIdParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", "Invalid approval id", { retriable: false });
  }
  return parsed.data;
}

function requestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function withRequestId(response: Response, id: string): Response {
  if (response.status === 101 || response.webSocket) {
    return response;
  }
  const wrapped = new Response(response.body, response);
  wrapped.headers.set("X-Request-Id", id);
  return wrapped;
}

function downloadContentDisposition(filename: string): string {
  const safeName = filename.replace(/[\\"]/g, "_");
  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

agentApp.onError((error, c) => {
  const id = c.req.header("X-Request-Id") ?? requestId();
  const apiError = toAPIError(error);
  emitErrorEvent(c.env, {
    errorCategory: "agent",
    errorCode: apiError.code,
    httpStatus: apiError.status,
    route: routeName(c.req.raw),
    workerName: "agent",
    ...(error instanceof Error
      ? {
          message: error.message,
          ...(error.stack ? { stack: error.stack } : {}),
        }
      : {}),
  });
  return formatAgentRouteError(error, id);
});

agentApp.use("*", async (c, next) => {
  const startedAt = performance.now();
  let status = 500;
  try {
    await next();
    status = c.res.status;
  } finally {
    emitPerformanceMetric(c.env, {
      route: routeName(c.req.raw),
      statusClass: statusClass(status),
      totalMs: performance.now() - startedAt,
      workerName: "agent",
    });
  }
});

agentApp.get("/health", (c) => c.json({ ok: true, worker: "agent" }));

agentApp.get("/__internal/local-preview-origin", async (c) => {
  const previewUrl = c.req.header("X-Cheatcode-Local-Preview-Url");
  const previewHost = c.req.header("X-Cheatcode-Local-Preview-Host");
  if (!previewUrl || !previewHost) {
    throw new APIError(400, "invalid_request_body", "Missing local preview origin headers", {
      retriable: false,
    });
  }
  const headers = new Headers({ Host: previewHost });
  const cookie = c.req.header("X-Cheatcode-Local-Preview-Cookie");
  if (cookie) headers.set("Cookie", cookie);
  const origin = c.req.header("Origin");
  if (origin) headers.set("Origin", origin);
  const referer = c.req.header("Referer");
  if (referer) headers.set("Referer", referer);
  const clientHost = c.req.header("X-Cheatcode-Local-Preview-Client-Host");
  if (clientHost) headers.set("X-Cheatcode-Local-Preview-Client-Host", clientHost);
  const resolved = await resolveLocalPreviewOrigin(new Request(previewUrl, { headers }), c.env);
  if (!resolved) {
    throw new APIError(404, "invalid_request_body", "Local preview origin not found", {
      retriable: false,
    });
  }
  return c.json({
    originalHost: resolved.originalHost,
    signed: resolved.origin.signed,
    token: resolved.origin.token,
    url: resolved.origin.url,
  });
});

agentApp.post("/internal/users/:userId/delete-state", async (c) => {
  const rawBody = await c.req.raw.text();
  await verifyAgentMaintenanceRequest({
    rawBody,
    request: c.req.raw,
    secret: c.env.INTERNAL_MAINTENANCE_SECRET,
  });
  const userId = UserId(GatewayUserIdSchema.parse(c.req.param("userId")));
  const body = InternalUserStateDeleteBodySchema.parse(parseInternalMaintenanceJson(rawBody));
  let runStatesDeleted = 0;
  for (const runId of body.runIds) {
    const response = await fetchAgentRun(
      agentRunForRunId(c.env, runId),
      "https://agent-run.internal/delete-all",
      {
        headers: { "X-Cheatcode-User-Id": userId },
        method: "POST",
      },
    );
    if (response.ok) {
      runStatesDeleted += 1;
    }
  }

  // One sandbox per user: resolve it once. Account deletion tears it down; per-project deletion
  // only reclaims each project's own workspace so the user's OTHER projects survive.
  const sandbox = await sandboxForUser(c.env, userId);
  let projectStatesDeleted = 0;
  if (body.scope === "account") {
    await sandbox.destroySandbox();
    await sandbox.deleteDurableState();
    projectStatesDeleted = body.projects.length;
  } else {
    for (const project of body.projects) {
      if (project.workspaceSlug) {
        await sandbox.cleanupProjectWorkspace({ workspaceSlug: project.workspaceSlug });
      }
      projectStatesDeleted += 1;
    }
  }

  return c.json(
    InternalUserStateDeleteResponseSchema.parse({
      ok: true,
      projectStatesDeleted,
      projectVolumesDeleted: 0,
      runStatesDeleted,
    }),
  );
});

agentApp.get("/v1/outputs/:outputId/download", async (c) => {
  const parsedOutputId = OutputIdSchema.safeParse(c.req.param("outputId"));
  if (!parsedOutputId.success) {
    throw new APIError(400, "invalid_path_param", "Invalid output id", {
      details: { issues: parsedOutputId.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  const parsedQuery = OutputDownloadQuerySchema.safeParse({
    expires: c.req.query("expires"),
    sig: c.req.query("sig"),
  });
  if (!parsedQuery.success) {
    throw new APIError(400, "invalid_query_param", "Invalid output download signature", {
      details: { issues: parsedQuery.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  const isValid = await verifySignedOutputDownload({
    expires: parsedQuery.data.expires,
    outputId: parsedOutputId.data,
    secret: c.env.OUTPUT_DOWNLOAD_SIGNING_SECRET,
    signature: parsedQuery.data.sig,
  });
  if (!isValid) {
    throw new APIError(403, "permission_denied", "Invalid or expired output download URL", {
      retriable: false,
    });
  }

  const { db, close } = createDb(c.env.HYPERDRIVE);
  try {
    const output = await findGeneratedOutputOwner(db, parsedOutputId.data);
    if (!output) {
      throw new APIError(404, "not_found_output", "Output not found", { retriable: false });
    }
    if (output.expiresAt && output.expiresAt.getTime() < Date.now()) {
      throw new APIError(410, "gone_output_expired", "Output download has expired", {
        retriable: false,
      });
    }
    const object = await c.env.R2_OUTPUTS.get(output.r2Key);
    if (!object?.body) {
      throw new APIError(404, "not_found_output", "Output object not found", {
        retriable: false,
      });
    }
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, max-age=0, no-store",
        "Content-Disposition": downloadContentDisposition(output.filename),
        "Content-Type": output.mimeType,
      },
    });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

agentApp.post("/v1/threads/:threadId/runs", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const body = parseCreateRunRequestBody(await c.req.json());
  if (!isUuidRouteParam(threadId)) {
    return startLegacyThreadRun(c.env, userId, threadId, body);
  }

  const { db, close } = createDb(c.env.HYPERDRIVE);
  try {
    const parsedUserId = UserId(userId);
    const parsedThreadId = ThreadId(threadId);
    const { personalization, thread } = await withUserContext(db, parsedUserId, async (tx) => {
      const loadedThread = await getThread(tx, {
        threadId: parsedThreadId,
        userId: parsedUserId,
      });
      const loadedPersonalization = await loadRunPersonalization(tx, parsedUserId, body.model);
      return { personalization: loadedPersonalization, thread: loadedThread };
    });
    if (!thread) {
      throw new APIError(404, "not_found_thread", "Thread not found", { retriable: false });
    }
    const policy = await runEntitlementPolicy(c.env, userId);
    const result = await withUserContext(db, UserId(userId), (tx) =>
      createAgentRunForThread(tx, {
        agentName: body.agentName ?? DEFAULT_AGENT_NAME,
        maxActiveProjects: policy.maxProjects,
        maxConcurrentSandboxes: policy.maxConcurrentSandboxes,
        personalization,
        // One sandbox per user now: the project id no longer keys the sandbox.
        resolveSandboxName: () => userSandboxName(userId),
        source: "web",
        threadId: parsedThreadId,
        userId: parsedUserId,
        ...(body.budgetCapUsd === undefined ? {} : { budgetCapUsd: body.budgetCapUsd }),
        ...(body.model === undefined ? {} : { modelId: body.model }),
      }),
    );
    if (result.type === "thread-not-found") {
      throw new APIError(404, "not_found_thread", "Thread not found", { retriable: false });
    }
    if (result.type === "active-run-exists") {
      throw new APIError(409, "conflict_run_already_active", "An agent run is already active", {
        details: { runId: result.run.runId },
        hint: "Reconnect through the thread stream endpoint or cancel the active run first.",
        retriable: false,
      });
    }
    if (result.type === "project-read-only") {
      throw new APIError(403, "permission_plan_required", "Project is read-only after downgrade", {
        details: { archiveAfter: result.archiveAfter?.toISOString() ?? null },
        hint: "Delete or archive over-limit projects, or upgrade your plan to continue editing this project.",
        retriable: false,
      });
    }
    if (result.type === "sandbox-limit-reached") {
      throw new APIError(403, "permission_plan_required", "Concurrent sandbox limit reached", {
        details: {
          limit: result.limit,
          used: result.sandboxCount,
        },
        hint: "Upgrade your plan or delete an existing sandbox-backed project before starting another one.",
        retriable: false,
      });
    }
    if (result.type === "project-limit-reached") {
      throw new APIError(403, "permission_plan_required", "Active project limit reached", {
        details: { limit: result.limit, used: result.used },
        hint: "Upgrade your plan or archive an existing project before starting another one.",
        retriable: false,
      });
    }
    await withUserContext(db, UserId(userId), (tx) =>
      createThreadMessage(tx, {
        agentRunId: result.run.runId,
        parts: body.message.parts,
        role: "user",
        threadId: result.run.threadId,
        userId: UserId(userId),
      }),
    );
    const sandboxName = await userSandboxName(userId);
    const warmedSandbox = await sandboxForProject(c.env, userId, result.run.projectId);
    c.executionCtx.waitUntil(syncSandboxQuotaPeriod(warmedSandbox, policy.quotaPeriodEnd));
    const response = await startAgentRun(
      c.env,
      userId,
      result.run,
      body,
      sandboxName,
      policy,
      personalization,
    );
    return withRunLocation(response, result.run.runId);
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

agentApp.get("/v1/threads/:threadId/runs/stream", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const lastSeq = c.req.query("lastSeq") ?? "0";
  const run = await activeRunForThreadRoute(c.env, userId, threadId);
  if (!run) {
    return new Response(null, { status: 204 });
  }
  const stub = agentRunForRunId(c.env, run.runId);
  return fetchAgentRun(
    stub,
    `https://agent-run.internal/stream?lastSeq=${encodeURIComponent(lastSeq)}`,
    {
      headers: { "X-Cheatcode-User-Id": userId },
    },
  );
});

agentApp.get("/v1/threads/:threadId/runs/status", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const run = await activeRunForThreadRoute(c.env, userId, threadId);
  if (!run) {
    return new Response(null, { status: 204 });
  }
  const stub = agentRunForRunId(c.env, run.runId);
  return fetchAgentRun(stub, "https://agent-run.internal/status", {
    headers: { "X-Cheatcode-User-Id": userId },
  });
});

agentApp.post("/v1/runs/:runId/cancel", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const runId = parseRunRouteParam(c.req.param("runId"));
  const run = await runForRoute(c.env, userId, runId);
  return fetchAgentRun(agentRunForRunId(c.env, run.runId), "https://agent-run.internal/cancel", {
    headers: { "X-Cheatcode-User-Id": userId },
    method: "POST",
  });
});

agentApp.post("/v1/runs/:runId/approvals/:approvalId", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const runId = parseRunRouteParam(c.req.param("runId"));
  const approvalId = parseApprovalRouteParam(c.req.param("approvalId"));
  const body = ApprovalDecisionRequestSchema.parse(await c.req.json());
  const run = await runForRoute(c.env, userId, runId);
  return fetchAgentRun(agentRunForRunId(c.env, run.runId), "https://agent-run.internal/approval", {
    body: JSON.stringify({ ...body, approvalId, userId }),
    headers: { "X-Cheatcode-User-Id": userId },
    method: "POST",
  });
});

agentApp.post("/v1/runs/:runId/takeover", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const runId = parseRunRouteParam(c.req.param("runId"));
  const run = await runForRoute(c.env, userId, runId);
  const sandbox = await sandboxForProject(c.env, userId, run.projectId);
  const vncPassword = crypto.randomUUID();
  const resumeToken = `takeover_${crypto.randomUUID().replaceAll("-", "")}`;
  const vncStart = await sandbox.exec({
    command: [START_VNC_SCRIPT],
    env: { VNC_PASSWORD: vncPassword },
    timeoutMs: 30_000,
  });
  if (!vncStart.success) {
    throw new APIError(502, "sandbox_failed_to_start", "Unable to start browser takeover", {
      retriable: true,
    });
  }
  const exposed = await sandbox.exposePort({
    hostname: resolvePreviewHostname(c.env),
    port: TAKEOVER_PORT,
    tokenTtlMs: TAKEOVER_TTL_MS,
  });
  const stateResponse = await saveTakeoverState(c.env, userId, run.runId, {
    expiresAt: Date.now() + TAKEOVER_TTL_MS,
    resumeToken,
  });
  if (!stateResponse.ok) {
    await sandbox.unexposePort({ port: TAKEOVER_PORT }).catch(() => undefined);
    return stateResponse;
  }
  return c.json(
    TakeoverResponseSchema.parse({
      resumeToken,
      vncUrl: takeoverEmbedUrl(exposed.url, vncPassword),
    }),
  );
});

agentApp.post("/v1/runs/:runId/resume", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const runId = parseRunRouteParam(c.req.param("runId"));
  const body = ResumeTakeoverBodySchema.parse(await c.req.json());
  const run = await runForRoute(c.env, userId, runId);
  const stateResponse = await consumeTakeoverState(c.env, userId, run.runId, body.resumeToken);
  if (!stateResponse.ok) {
    return stateResponse;
  }
  const sandbox = await sandboxForProject(c.env, userId, run.projectId);
  await sandbox.unexposePort({ port: TAKEOVER_PORT });
  return c.json({ ok: true });
});

agentApp.get("/v1/threads/:threadId/sandbox/files", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const query = SandboxFileListQuerySchema.parse({
    includeHidden: c.req.query("includeHidden") ?? undefined,
    path: c.req.query("path") ?? undefined,
    recursive: c.req.query("recursive") ?? undefined,
  });
  const sandbox = await sandboxForThread(c.env, userId, threadId);
  const result = await sandbox.listFiles(query);
  return c.json(SandboxFileListSchema.parse(result));
});

agentApp.get("/v1/threads/:threadId/sandbox/ide", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  await requireWritableThreadProject(c.env, userId, threadId);
  const project = await terminalProjectForThread(c.env, userId, threadId);
  const sandbox = project
    ? await sandboxForProject(c.env, userId, project.id)
    : await sandboxForThread(c.env, userId, threadId);
  const files = await sandbox.listFiles({
    includeHidden: false,
    path: SANDBOX_WORKSPACE_ROOT,
    recursive: true,
  });
  // Per-user "computer": a project chat opens its own folder (/workspace/<slug>, header = slug);
  // a project-less chat opens the whole computer root (/workspace, relabelled "COMPUTER").
  const workspacePath = project?.workspaceSlug
    ? workspacePathForSlug(project.workspaceSlug)
    : SANDBOX_WORKSPACE_ROOT;
  const initialFilePath = project
    ? selectInitialCodeServerFile(files.files, workspacePath)
    : undefined;
  const session = await sandbox.exposeCodeServer({
    hostname: resolvePreviewHostname(c.env),
    ...(initialFilePath ? { initialFilePath } : {}),
    workspacePath,
  });
  return c.json(
    SandboxIdeSessionSchema.parse({
      ...session,
      displayWorkspacePath: terminalDisplayCwd(session.workspacePath),
    }),
  );
});

// Wake the app preview when the user opens the Computer panel: start the sandbox if it
// idle-stopped and relaunch the dev server if its process died. Returns a fresh preview URL.
agentApp.post("/v1/threads/:threadId/sandbox/preview/wake", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  await requireWritableThreadProject(c.env, userId, threadId);
  const project = await terminalProjectForThread(c.env, userId, threadId);
  const sandbox = project
    ? await sandboxForProject(c.env, userId, project.id)
    : await sandboxForThread(c.env, userId, threadId);
  // wakePreview re-mints the signed Metro URL for a mobile dev server and returns the exp(s)://
  // deep link directly (expoUrl) — the web/local paths leave it undefined. The workspaceSlug selects
  // this project's dev server among the sandbox's per-project ones (slot keyed by slug).
  const result = await sandbox.wakePreview({
    hostname: resolvePreviewHostname(c.env),
    // A project chat wakes its own dev server (slot keyed by slug, normalized to "app" for legacy
    // slug-less projects); a project-less chat has no dev server to revive, so omit the slug.
    ...(project ? { workspaceSlug: previewWorkspaceSlug(project.workspaceSlug) } : {}),
  });
  return c.json(SandboxPreviewWakeSchema.parse(result));
});

// Current sandbox lifecycle state for the preview panel (polled while the panel is open so the
// UI can show a booting spinner or a paused/resume affordance without hitting a dead iframe).
agentApp.get("/v1/threads/:threadId/sandbox/preview/status", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  await requireWritableThreadProject(c.env, userId, threadId);
  const project = await terminalProjectForThread(c.env, userId, threadId);
  const sandbox = project
    ? await sandboxForProject(c.env, userId, project.id)
    : await sandboxForThread(c.env, userId, threadId);
  if (project) {
    // Per-project liveness: the shared per-user sandbox can be "started" while THIS project's dev
    // server is dead (idle-stop killed its process), so probe the project's own dev-server port
    // instead of reading only the sandbox state — otherwise the web wake guard never fires and the
    // preview stays blank. The slot defaults to "app" for legacy slug-less projects (GAP 4).
    const status = await sandbox.projectPreviewStatus({
      workspaceSlug: previewWorkspaceSlug(project.workspaceSlug),
    });
    return c.json(SandboxPreviewStatusSchema.parse(status));
  }
  // Project-less chat: no dev server to probe — report the raw sandbox lifecycle state, preferring
  // the webhook-fed cache (Daytona sandbox.state.updated) keyed by the sandbox UUID (no Daytona API
  // call), falling back to a live read when the cache is cold.
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
});

agentApp.get("/v1/threads/:threadId/sandbox/file", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const path = SandboxFilePathSchema.parse(c.req.query("path"));
  const encoding = SandboxReadEncodingQuerySchema.parse(c.req.query("encoding") ?? undefined);
  const sandbox = await sandboxForThread(c.env, userId, threadId);
  const file = await sandbox.readFile({ path, ...(encoding ? { encoding } : {}) });
  return c.json(SandboxFileSchema.parse(file));
});

agentApp.get("/v1/threads/:threadId/sandbox/file-preview", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const path = SandboxFilePathSchema.parse(c.req.query("path"));
  const sandbox = await sandboxForThread(c.env, userId, threadId);
  const preview = await sandbox.previewFile({ path });
  return c.json(SandboxFilePreviewSchema.parse(preview));
});

agentApp.patch("/v1/threads/:threadId/sandbox/file", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const body = UpdateSandboxPathFileSchema.parse(await c.req.json());
  await requireWritableThreadProject(c.env, userId, threadId);
  const sandbox = await sandboxForThread(c.env, userId, threadId);
  const result = await sandbox.writeFile({
    content: body.content,
    encoding: body.encoding,
    path: body.path,
  });
  return c.json(SandboxFileWriteSchema.parse(result));
});

agentApp.get("/v1/threads/:threadId/sandbox/files/:fileKey", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const fileKey = SandboxFileKeySchema.parse(c.req.param("fileKey"));
  const encoding = SandboxReadEncodingQuerySchema.parse(c.req.query("encoding") ?? undefined);
  const sandbox = await sandboxForThread(c.env, userId, threadId);
  const file = await sandbox.readFile({
    path: SANDBOX_FILE_PATHS[fileKey],
    ...(encoding ? { encoding } : {}),
  });
  return c.json(
    SandboxFileSchema.parse({
      content: file.content,
      encoding: file.encoding,
      key: fileKey,
      path: file.path,
    }),
  );
});

agentApp.patch("/v1/threads/:threadId/sandbox/files/:fileKey", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const fileKey = SandboxFileKeySchema.parse(c.req.param("fileKey"));
  const body = UpdateSandboxFileSchema.parse(await c.req.json());
  await requireWritableThreadProject(c.env, userId, threadId);
  const sandbox = await sandboxForThread(c.env, userId, threadId);
  const result = await sandbox.writeFile({
    content: body.content,
    encoding: body.encoding,
    path: SANDBOX_FILE_PATHS[fileKey],
  });
  return c.json(SandboxFileWriteSchema.parse(result));
});

agentApp.get("/v1/threads/:threadId/sandbox/terminal/context", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const project = await terminalProjectForThread(c.env, userId, threadId);
  const sandbox = project
    ? await sandboxForProject(c.env, userId, project.id)
    : await sandboxForThread(c.env, userId, threadId);
  // Per-user "computer": scope the terminal to the project's own folder (/workspace/<slug>) when
  // the chat has a project, otherwise the whole computer root.
  const cwd = project?.workspaceSlug
    ? workspacePathForSlug(project.workspaceSlug)
    : SANDBOX_WORKSPACE_ROOT;
  return c.json(
    SandboxTerminalContextSchema.parse({
      cwd,
      displayCwd: terminalDisplayCwd(cwd),
      displayWorkspacePath: TERMINAL_DISPLAY_WORKSPACE,
      host: project ? await sandbox.runtimeSandboxId() : threadId.slice(0, 12),
    }),
  );
});

agentApp.post("/v1/threads/:threadId/sandbox/terminal", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const body = SandboxTerminalCommandSchema.parse(await c.req.json());
  await requireWritableThreadProject(c.env, userId, threadId);
  const project = await terminalProjectForThread(c.env, userId, threadId);
  const sandbox = project
    ? await sandboxForProject(c.env, userId, project.id)
    : await sandboxForThread(c.env, userId, threadId);
  const cwdMarker = `__CHEATCODE_CWD_${crypto.randomUUID()}__`;
  const result = await sandbox.exec({
    command: ["sh", "-lc", withTerminalCwdMarker(body.command, cwdMarker)],
    cwd: body.cwd,
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
});

agentApp.get("/v1/threads/:threadId/sandbox/console", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const query = SandboxConsoleQuerySchema.parse({
    lastPid: c.req.query("lastPid") ?? undefined,
    processId: c.req.query("processId") ?? undefined,
    stderrCursor: c.req.query("stderrCursor") ?? undefined,
    stdoutCursor: c.req.query("stdoutCursor") ?? undefined,
    tail: c.req.query("tail") ?? undefined,
  });
  // Scope the console to the active project's dev-server slot so a project chat never shows another
  // project's logs (the per-user sandbox hosts every project's dev server side by side).
  const project = await terminalProjectForThread(c.env, userId, threadId);
  const sandbox = project
    ? await sandboxForProject(c.env, userId, project.id)
    : await sandboxForThread(c.env, userId, threadId);
  const snapshot = await sandbox.readDevServerLogs(
    project
      ? { ...query, processId: `app-preview:${previewWorkspaceSlug(project.workspaceSlug)}` }
      : query,
  );
  return c.json(SandboxConsoleSnapshotSchema.parse(snapshot));
});

function takeoverEmbedUrl(previewUrl: string, password: string): string {
  const url = new URL(previewUrl);
  // Cheatcode preview-proxy access token (see project-sandbox-preview.ts). Loading
  // vnc.html with it sets the cc_pt cookie (first-party in a takeover tab), which
  // authorizes the websockify WS upgrade; we also carry it on the WS path as a
  // fallback for cookie-restricted contexts (double-encoded so the proxy decodes
  // back to the original base64 token).
  const previewToken = url.searchParams.get("__cc_pt");
  url.pathname = "/vnc.html";
  url.searchParams.set("autoconnect", "1");
  url.searchParams.set("resize", "scale");
  url.searchParams.set("password", password);
  if (previewToken) {
    url.searchParams.set("path", `websockify?__cc_pt=${encodeURIComponent(previewToken)}`);
  }
  return url.toString();
}

// Legacy slug-less projects were built into /workspace/app with the dev-server slot "app-preview:app"
// (the app-builder's basename fallback). Normalize a null workspaceSlug to "app" so the wake, status,
// and console routes all address that same slot — otherwise they'd miss it and fall back wrongly.
function previewWorkspaceSlug(workspaceSlug: string | null): string {
  return workspaceSlug ?? "app";
}

async function terminalProjectForThread(
  env: AgentEnv,
  userId: string,
  threadId: string,
): Promise<{ id: string; name: string; workspaceSlug: string | null } | null> {
  if (!isUuidRouteParam(threadId)) {
    return null;
  }
  const parsedUserId = UserId(userId);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    return await withUserContext(db, parsedUserId, async (tx) => {
      const thread = await getThread(tx, { threadId: ThreadId(threadId), userId: parsedUserId });
      if (!thread) {
        throw new APIError(404, "not_found_thread", "Thread not found", { retriable: false });
      }
      if (!thread.projectId) {
        return null;
      }
      const project = await getProject(tx, {
        projectId: ProjectId(thread.projectId),
        userId: parsedUserId,
      });
      if (!project) {
        throw new APIError(404, "not_found_project", "Project not found", { retriable: false });
      }
      return { id: project.id, name: project.name, workspaceSlug: project.workspaceSlug };
    });
  } finally {
    await close();
  }
}

const APP_ENTRY_FILE_NAMES = new Set([
  "app.js",
  "index.html",
  "next.config.js",
  "package.json",
  "vite.config.js",
]);

const CODE_SERVER_IGNORED_SEGMENTS = new Set([
  ".git",
  ".next",
  ".turbo",
  "dist",
  "node_modules",
  "out",
]);

const CODE_SERVER_DELIVERABLE_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".odp",
  ".ods",
  ".odt",
  ".pdf",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
]);

const CODE_SERVER_ENTRY_RELATIVE_PATHS = [
  "index.html",
  "package.json",
  "src/app/page.tsx",
  "src/app/page.jsx",
  "src/App.tsx",
  "src/App.jsx",
  "src/main.tsx",
  "src/main.jsx",
  "app.js",
  "main.py",
  "README.md",
];

function selectInitialCodeServerFile(
  files: SandboxFileEntry[],
  workspacePath: string,
): string | undefined {
  const candidates = files
    .filter((file) => file.type === "file" && isCodeServerCandidate(file.path, workspacePath))
    .sort(
      (left, right) =>
        codeServerFileScore(right, workspacePath) - codeServerFileScore(left, workspacePath),
    );
  return candidates[0]?.path;
}

function isCodeServerCandidate(path: string, workspacePath: string): boolean {
  if (!path.startsWith(`${workspacePath}/`)) {
    return false;
  }
  const relativePath = path.slice(workspacePath.length + 1);
  return !relativePath.split("/").some((segment) => CODE_SERVER_IGNORED_SEGMENTS.has(segment));
}

function codeServerFileScore(file: SandboxFileEntry, workspacePath: string): number {
  const relativePath = file.path.slice(workspacePath.length + 1);
  const extension = extensionOf(file.name);
  if (CODE_SERVER_DELIVERABLE_EXTENSIONS.has(extension)) {
    return 1_000 - relativePath.split("/").length;
  }
  const entryIndex = CODE_SERVER_ENTRY_RELATIVE_PATHS.indexOf(relativePath);
  if (entryIndex !== -1) {
    return 900 - entryIndex;
  }
  if (APP_ENTRY_FILE_NAMES.has(file.name)) {
    return 800;
  }
  if (isLikelySourceExtension(extension)) {
    return 500 - relativePath.split("/").length;
  }
  return 100 - relativePath.length / 1_000;
}

function extensionOf(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex <= 0 ? "" : filename.slice(dotIndex).toLowerCase();
}

function isLikelySourceExtension(extension: string): boolean {
  return [".css", ".html", ".js", ".jsx", ".json", ".md", ".py", ".ts", ".tsx"].includes(extension);
}

function terminalDisplayCwd(cwd: string): string {
  if (cwd === SANDBOX_WORKSPACE_ROOT) {
    return TERMINAL_DISPLAY_WORKSPACE;
  }
  if (cwd.startsWith(`${SANDBOX_WORKSPACE_ROOT}/`)) {
    return `${TERMINAL_DISPLAY_WORKSPACE}/${cwd.slice(SANDBOX_WORKSPACE_ROOT.length + 1)}`;
  }
  return cwd;
}

const SandboxStateCacheSchema = z
  .object({ state: z.string().min(1).max(50), updatedAt: z.string().optional() })
  .strict();

export const sandboxStateCacheKey = (daytonaId: string): string => `sbx:${daytonaId}`;

// Read the webhook-fed sandbox lifecycle state (written by webhooks-worker on
// Daytona sandbox.state.updated). Returns null when unbound, absent, or malformed.
async function readSandboxStateCache(
  env: AgentEnv,
  daytonaId: string,
): Promise<z.infer<typeof SandboxStateCacheSchema> | null> {
  if (!env.SANDBOX_STATE) {
    return null;
  }
  const raw = await env.SANDBOX_STATE.get(sandboxStateCacheKey(daytonaId)).catch(() => null);
  if (!raw) {
    return null;
  }
  try {
    const parsed = SandboxStateCacheSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function withTerminalCwdMarker(command: string, marker: string): string {
  return `${command}
__cc_terminal_status=$?
printf '\\n%s%s\\n' ${shellQuote(marker)} "$PWD"
exit "$__cc_terminal_status"`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function extractTerminalCwd(stdout: string, marker: string): { cwd?: string; stdout: string } {
  const lines = stdout.split(/\r?\n/u);
  const keptLines: string[] = [];
  let cwd: string | undefined;
  for (const line of lines) {
    if (line.startsWith(marker)) {
      const nextCwd = line.slice(marker.length).trim();
      if (nextCwd.length > 0) {
        cwd = nextCwd;
      }
      continue;
    }
    keptLines.push(line);
  }
  return {
    ...(cwd === undefined ? {} : { cwd }),
    stdout: keptLines.join("\n"),
  };
}

function resolvePreviewHostname(env: AgentEnv): string {
  return PreviewHostnameSchema.parse(env.PREVIEW_HOSTNAME);
}

function routeName(request: Request): string {
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}`;
}

function statusClass(status: number): string {
  if (status >= 500) {
    return "5xx";
  }
  if (status >= 400) {
    return "4xx";
  }
  if (status >= 300) {
    return "3xx";
  }
  return "2xx";
}

const agentHandler = {
  async fetch(request: Request, env: AgentEnv, ctx: ExecutionContext): Promise<Response> {
    AgentWorkerEnvSchema.parse(env);
    const id = request.headers.get("X-Request-Id") ?? requestId();
    try {
      const requestWithId = isWebSocketUpgrade(request) ? request : new Request(request);
      if (!isWebSocketUpgrade(requestWithId)) {
        requestWithId.headers.set("X-Request-Id", id);
      }
      const localPreview = await tryHandleLocalPreviewRequest(requestWithId, env);
      if (localPreview) {
        return withRequestId(localPreview, id);
      }
      const response = await agentApp.fetch(requestWithId, env, ctx);
      return withRequestId(response, id);
    } catch (error) {
      const apiError = toAPIError(error);
      emitErrorEvent(env, {
        errorCategory: "agent",
        errorCode: apiError.code,
        httpStatus: apiError.status,
        route: routeName(request),
        workerName: "agent",
        ...(error instanceof Error
          ? {
              message: error.message,
              ...(error.stack ? { stack: error.stack } : {}),
            }
          : {}),
      });
      return apiError.toResponse(id);
    }
  },
};

function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}

export default withErrorHandler(agentHandler, {
  errorCategory: "agent",
  requestId: (request) => request.headers.get("X-Request-Id"),
  routeName,
  workerName: "agent",
});
