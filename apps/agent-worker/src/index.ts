import {
  createAgentRunForThread,
  createDb,
  createThreadMessage,
  findGeneratedOutputOwner,
  getThread,
  withUserContext,
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
  SandboxConsoleQuerySchema,
  SandboxConsoleSnapshotSchema,
  SandboxFileKeySchema,
  SandboxFileListSchema,
  SandboxFilePathSchema,
  SandboxFileSchema,
  SandboxFileWriteSchema,
  SandboxTerminalCommandSchema,
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
  projectSandboxName,
  readGatewayUserId,
} from "./tenancy";

export { AgentRun, ProjectSandbox };

export interface AgentEnv extends AnalyticsBindings {
  AGENT_RUN: DurableObjectNamespace<AgentRun>;
  BL_API_KEY: string;
  BL_REGION: string;
  BL_WORKSPACE: string;
  BLAXEL_SANDBOX_IMAGE: string;
  BLAXEL_SANDBOX_MEMORY_MB?: string;
  COMPOSIO_API_KEY?: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
  INTERNAL_MAINTENANCE_SECRET?: WorkerSecret;
  OUTPUT_DOWNLOAD_BASE_URL?: string;
  OUTPUT_DOWNLOAD_SIGNING_SECRET: string;
  PREVIEW_HOSTNAME?: string;
  PROJECT_SANDBOX: DurableObjectNamespace<ProjectSandbox>;
  QUOTA_TRACKER?: DurableObjectNamespace;
  R2_AUDIT: R2Bucket;
  R2_OUTPUTS: R2Bucket;
  R2_OUTPUTS_BUCKET_NAME?: string;
}

const DEFAULT_PREVIEW_HOSTNAME = "trycheatcode.com";
const DEFAULT_AGENT_NAME = "general";
const START_VNC_SCRIPT = "/opt/cheatcode/start-vnc.sh";
const TAKEOVER_PORT = 6080;
const TAKEOVER_TTL_MS = 15 * 60 * 1000;
const DEFAULT_SANDBOX_FILE_LIST_ROOT = "/workspace/app/src/app";

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
    projectIds: z.array(z.string().uuid()).max(1_000),
    runIds: z.array(z.string().uuid()).max(10_000),
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

  let projectStatesDeleted = 0;
  let projectVolumesDeleted = 0;
  for (const projectId of body.projectIds) {
    const sandbox = await sandboxForProject(c.env, userId, projectId);
    await sandbox.destroySandbox();
    if (await sandbox.deleteProjectVolume()) {
      projectVolumesDeleted += 1;
    }
    await sandbox.deleteDurableState();
    projectStatesDeleted += 1;
  }

  return c.json(
    InternalUserStateDeleteResponseSchema.parse({
      ok: true,
      projectStatesDeleted,
      projectVolumesDeleted,
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
    const sandboxName = await projectSandboxName(userId, thread.projectId);
    const policy = await runEntitlementPolicy(c.env, userId);
    const result = await withUserContext(db, UserId(userId), (tx) =>
      createAgentRunForThread(tx, {
        agentName: body.agentName ?? DEFAULT_AGENT_NAME,
        maxConcurrentSandboxes: policy.maxConcurrentSandboxes,
        personalization,
        sandboxId: sandboxName,
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
    await withUserContext(db, UserId(userId), (tx) =>
      createThreadMessage(tx, {
        agentRunId: result.run.runId,
        parts: body.message.parts,
        role: "user",
        threadId: result.run.threadId,
        userId: UserId(userId),
      }),
    );
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

agentApp.get("/v1/threads/:threadId/sandbox/file", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const path = SandboxFilePathSchema.parse(c.req.query("path"));
  const encoding = SandboxReadEncodingQuerySchema.parse(c.req.query("encoding") ?? undefined);
  const sandbox = await sandboxForThread(c.env, userId, threadId);
  const file = await sandbox.readFile({ path, ...(encoding ? { encoding } : {}) });
  return c.json(SandboxFileSchema.parse(file));
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

agentApp.post("/v1/threads/:threadId/sandbox/terminal", async (c) => {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId"));
  const body = SandboxTerminalCommandSchema.parse(await c.req.json());
  await requireWritableThreadProject(c.env, userId, threadId);
  const sandbox = await sandboxForThread(c.env, userId, threadId);
  const result = await sandbox.exec({
    command: ["sh", "-lc", body.command],
    cwd: body.cwd,
    timeoutMs: body.timeoutMs,
  });
  return c.json(SandboxTerminalResultSchema.parse(result));
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
  const sandbox = await sandboxForThread(c.env, userId, threadId);
  const snapshot = await sandbox.readDevServerLogs(query);
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
      const requestWithId = new Request(request);
      requestWithId.headers.set("X-Request-Id", id);
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

export default withErrorHandler(agentHandler, {
  errorCategory: "agent",
  requestId: (request) => request.headers.get("X-Request-Id"),
  routeName,
  workerName: "agent",
});
