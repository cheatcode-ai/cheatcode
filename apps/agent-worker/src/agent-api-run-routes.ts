import {
  type AgentRunHandle,
  createAgentRunForThread,
  createDb,
  createThreadMessage,
  getThread,
  type RunPersonalization,
  reconcileAbsentAgentRunStart,
  withUserContext,
} from "@cheatcode/db";
import { APIError, readJsonRequest } from "@cheatcode/observability";
import {
  type AgentRunId,
  ApprovalDecisionRequestSchema,
  type CreateRun,
  ThreadId,
  UserId as toUserId,
  type UserId,
} from "@cheatcode/types";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AgentEnv } from "./agent-env";
import {
  type AgentRunAdmissionOutcome,
  activeRunForThreadRoute,
  agentRunForRunId,
  fetchAgentRun,
  reconcileAgentRunAdmission,
  runEntitlementPolicy,
  runForRoute,
  sandboxForUser,
  startAgentRun,
  syncSandboxQuotaPeriod,
  withRunLocation,
} from "./agent-routing";
import { loadRunPersonalization } from "./run-personalization";
import { parseCreateRunRequestBody } from "./run-request";
import {
  parseRunRouteParam,
  parseThreadRouteParam,
  readGatewayUserId,
  userSandboxName,
} from "./tenancy";

const MAX_APPROVAL_BODY_BYTES = 4 * 1024;
const MAX_CREATE_RUN_BODY_BYTES = 64 * 1024;
const RUN_IDEMPOTENCY_KEY_HASH_HEADER = "X-Cheatcode-Idempotency-Key-Hash";
const RUN_REQUEST_BODY_HASH_HEADER = "X-Cheatcode-Request-Body-Hash";
const ApprovalIdParamSchema = z.string().uuid();
const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);
type AgentContext = Context<{ Bindings: AgentEnv }>;
type CreateRunResult = Awaited<ReturnType<typeof createAgentRunForThread>>;
type ExistingRunResult = Extract<
  CreateRunResult,
  { type: "active-run-exists" | "idempotent-replay" }
>;
type RejectedRunResult = Exclude<
  CreateRunResult,
  ExistingRunResult | Extract<CreateRunResult, { type: "created" }>
>;

export function registerAgentRunHttpRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  app.post("/v1/threads/:threadId/runs", createRun);
  app.get("/v1/threads/:threadId/runs/stream", streamActiveRun);
  app.get("/v1/threads/:threadId/runs/status", activeRunStatus);
  app.post("/v1/runs/:runId/cancel", cancelRun);
  app.post("/v1/runs/:runId/approvals/:approvalId", decideApproval);
}

async function createRun(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const parsedUserId = toUserId(userId);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  const body = parseCreateRunRequestBody(
    await readJsonRequest(c.req.raw, MAX_CREATE_RUN_BODY_BYTES, "Create run request"),
  );
  const requestIdentity = readRunRequestIdentity(c.req.raw.headers);
  const personalization = await loadRequestPersonalization(c.env, parsedUserId, threadId, body);
  const policy = await runEntitlementPolicy(c.env, userId);
  const sandboxName = await userSandboxName(userId);
  const sandbox = await sandboxForUser(c.env, userId);
  await syncSandboxQuotaPeriod(sandbox, policy.quotaPeriodEnd);
  const result = await persistRunRequest(c.env, {
    body,
    personalization,
    requestIdentity,
    threadId,
    userId: parsedUserId,
  });
  if (result.type === "created") {
    const outcome = await startAgentRun(c.env, {
      body,
      modelExplicit: result.modelExplicit,
      personalization,
      run: result.run,
      sandboxName,
      userId,
    });
    return resolveRunAdmission(c.env, parsedUserId, result.run, outcome);
  }
  if (result.type === "active-run-exists" || result.type === "idempotent-replay") {
    const outcome = await reconcileAgentRunAdmission(c.env, userId, result.run.runId);
    return resolveRunAdmission(c.env, parsedUserId, result.run, outcome);
  }
  throw rejectedRunError(result);
}

async function loadRequestPersonalization(
  env: AgentEnv,
  userId: UserId,
  threadId: string,
  body: CreateRun,
): Promise<RunPersonalization> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    return await withUserContext(db, userId, async (tx) => {
      const thread = await getThread(tx, { threadId: ThreadId(threadId), userId });
      if (!thread) {
        throw new APIError(404, "not_found_thread", "Thread not found", { retriable: false });
      }
      return loadRunPersonalization(tx, userId, body.model);
    });
  } finally {
    await close();
  }
}

async function persistRunRequest(
  env: AgentEnv,
  input: {
    body: CreateRun;
    personalization: RunPersonalization;
    requestIdentity: { bodyHash: string; keyHash: string };
    threadId: string;
    userId: UserId;
  },
): Promise<CreateRunResult> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    return await withUserContext(db, input.userId, async (tx) => {
      const created = await createAgentRunForThread(tx, {
        idempotencyKeyHash: input.requestIdentity.keyHash,
        personalization: input.personalization,
        requestBodyHash: input.requestIdentity.bodyHash,
        threadId: ThreadId(input.threadId),
        userId: input.userId,
        ...(input.body.model === undefined ? {} : { modelId: input.body.model }),
      });
      if (created.type === "created") {
        await createThreadMessage(tx, {
          agentRunId: created.run.runId,
          parts: input.body.message.parts,
          role: "user",
          threadId: created.run.threadId,
          userId: input.userId,
        });
      }
      return created;
    });
  } finally {
    await close();
  }
}

function rejectedRunError(result: RejectedRunResult): APIError {
  if (result.type === "thread-not-found") {
    return new APIError(404, "not_found_thread", "Thread not found", { retriable: false });
  }
  if (result.type === "idempotency-key-reused") {
    return new APIError(422, "idempotency_key_reused", "Idempotency key was reused", {
      hint: "Generate a new Idempotency-Key for a different thread or request body.",
      retriable: false,
    });
  }
  if (result.type === "project-read-only") {
    return new APIError(403, "permission_plan_required", "Project is read-only after downgrade", {
      details: { archiveAfter: result.archiveAfter?.toISOString() ?? null },
      hint: "Delete or archive over-limit projects, or upgrade your plan to continue editing this project.",
      retriable: false,
    });
  }
  return new APIError(403, "permission_plan_required", "Active project limit reached", {
    details: { limit: result.limit, used: result.used },
    hint: "Upgrade your plan or archive an existing project before starting another one.",
    retriable: false,
  });
}

async function resolveRunAdmission(
  env: AgentEnv,
  userId: UserId,
  run: AgentRunHandle,
  outcome: AgentRunAdmissionOutcome,
): Promise<Response> {
  if (outcome.type === "confirmed") {
    return withRunLocation(outcome.response, run.runId);
  }
  if (outcome.type === "ambiguous") {
    throw runAdmissionAmbiguousError(run.runId);
  }
  const reconciliation = await reconcileAbsentRunRow(env, userId, run.runId);
  if (reconciliation === "not-found") {
    throw runAdmissionAmbiguousError(run.runId);
  }
  throw runAdmissionAbsentError(run.runId);
}

async function reconcileAbsentRunRow(
  env: AgentEnv,
  userId: UserId,
  runId: AgentRunId,
): Promise<"failed" | "not-found" | "terminal"> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    return await withUserContext(db, userId, (tx) =>
      reconcileAbsentAgentRunStart(tx, { runId, userId }),
    );
  } finally {
    await close();
  }
}

function runAdmissionAbsentError(runId: AgentRunId): APIError {
  return new APIError(409, "conflict_state_invalid", "Agent run was not admitted", {
    details: { runId },
    hint: "Retry the prompt with a new Idempotency-Key.",
    retriable: true,
  });
}

function runAdmissionAmbiguousError(runId: AgentRunId): APIError {
  return new APIError(503, "unavailable_maintenance", "Agent run admission is uncertain", {
    details: { runId },
    hint: "Retry this same request so Cheatcode can reconcile the existing run safely.",
    retriable: true,
  });
}

async function streamActiveRun(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  const lastSeq = c.req.query("lastSeq") ?? "0";
  const run = await activeRunForThreadRoute(c.env, userId, threadId);
  if (!run) {
    return new Response(null, { status: 204 });
  }
  return fetchAgentRun(
    agentRunForRunId(c.env, run.runId),
    `https://agent-run.internal/stream?lastSeq=${encodeURIComponent(lastSeq)}`,
    { headers: { "X-Cheatcode-User-Id": userId } },
  );
}

async function activeRunStatus(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const threadId = parseThreadRouteParam(c.req.param("threadId") ?? "");
  const run = await activeRunForThreadRoute(c.env, userId, threadId);
  if (!run) {
    return new Response(null, { status: 204 });
  }
  return fetchAgentRun(agentRunForRunId(c.env, run.runId), "https://agent-run.internal/status", {
    headers: { "X-Cheatcode-User-Id": userId },
  });
}

async function cancelRun(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const runId = parseRunRouteParam(c.req.param("runId") ?? "");
  const run = await runForRoute(c.env, userId, runId);
  return fetchAgentRun(agentRunForRunId(c.env, run.runId), "https://agent-run.internal/cancel", {
    headers: { "X-Cheatcode-User-Id": userId },
    method: "POST",
  });
}

async function decideApproval(c: AgentContext): Promise<Response> {
  const userId = readGatewayUserId(c.req.raw.headers);
  const runId = parseRunRouteParam(c.req.param("runId") ?? "");
  const approvalId = parseApprovalRouteParam(c.req.param("approvalId") ?? "");
  const body = ApprovalDecisionRequestSchema.parse(
    await readJsonRequest(c.req.raw, MAX_APPROVAL_BODY_BYTES, "Approval decision request"),
  );
  const run = await runForRoute(c.env, userId, runId);
  return fetchAgentRun(agentRunForRunId(c.env, run.runId), "https://agent-run.internal/approval", {
    body: JSON.stringify({ ...body, approvalId, userId }),
    headers: { "X-Cheatcode-User-Id": userId },
    method: "POST",
  });
}

function readRunRequestIdentity(headers: Headers): { bodyHash: string; keyHash: string } {
  const parsed = z.object({ bodyHash: Sha256HexSchema, keyHash: Sha256HexSchema }).safeParse({
    bodyHash: headers.get(RUN_REQUEST_BODY_HASH_HEADER),
    keyHash: headers.get(RUN_IDEMPOTENCY_KEY_HASH_HEADER),
  });
  if (!parsed.success) {
    throw new APIError(400, "invalid_request_body", "Missing internal run request identity", {
      retriable: false,
    });
  }
  return parsed.data;
}

function parseApprovalRouteParam(value: string): string {
  const parsed = ApprovalIdParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", "Invalid approval id", { retriable: false });
  }
  return parsed.data;
}
