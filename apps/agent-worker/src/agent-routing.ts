import {
  type EntitlementCache,
  entitlementCacheFromValues,
  quotaPeriodEndFor,
} from "@cheatcode/billing";
import {
  type AgentRunHandle,
  createDb,
  findActiveAgentRunForThread,
  findAgentEntitlementByUserId,
  findAgentRunForUser,
  getProject,
  getProjectWriteState,
  getThread,
  type RunPersonalization,
  withUserContext,
} from "@cheatcode/db";
import {
  APIError,
  createLogger,
  emitUserEvent,
  readBoundedResponseJson,
} from "@cheatcode/observability";
import {
  AgentRunId,
  type CreateRun,
  ProjectId,
  type ProjectSummary,
  ThreadId,
  UserId,
} from "@cheatcode/types";
import {
  QUOTA_FEATURES,
  QUOTA_TRACKER_MAX_RESPONSE_BYTES,
  QuotaPeekRequestSchema,
  QuotaSetLimitRequestSchema,
  QuotaSetLimitResponseSchema,
  QuotaUsageResponseSchema,
} from "@cheatcode/types/quota";
import type { AgentEnv } from "./agent-env";
import type { AgentRun } from "./durable-objects/agent-run";
import type { ProjectSandbox } from "./durable-objects/project-sandbox";
import { extractRunMessageText } from "./run-request";
import { userSandboxName } from "./tenancy";

const DO_FREE_TIER_DURATION_ERROR = "Exceeded allowed duration in Durable Objects free tier";

export interface RunEntitlementPolicy {
  quotaPeriodEnd: string;
}

export type AgentRunAdmissionOutcome =
  | { response: Response; type: "confirmed" }
  | { type: "absent" }
  | { type: "ambiguous" };

/** Raw user-keyed stub for account maintenance that must bypass owner registration. */
export async function sandboxStubForUser(
  env: AgentEnv,
  userId: string,
): Promise<DurableObjectStub<ProjectSandbox>> {
  return (await sandboxIdentityForUser(env, userId)).sandbox;
}

/** Operational lookup that establishes and verifies the sandbox owner before use. */
export async function sandboxForUser(
  env: AgentEnv,
  userId: string,
): Promise<DurableObjectStub<ProjectSandbox>> {
  const { sandbox, sandboxName } = await sandboxIdentityForUser(env, userId);
  await sandbox.registerOwner(userId, sandboxName);
  return sandbox;
}

async function sandboxIdentityForUser(env: AgentEnv, userId: string) {
  const sandboxName = await userSandboxName(userId);
  return {
    sandbox: env.PROJECT_SANDBOX.get(env.PROJECT_SANDBOX.idFromName(sandboxName)),
    sandboxName,
  };
}

export async function requireWritableThreadProject(
  env: AgentEnv,
  userId: string,
  threadId: string,
): Promise<void> {
  const parsedUserId = UserId(userId);
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    await withUserContext(db, parsedUserId, async (tx) => {
      const thread = await getThread(tx, { threadId: ThreadId(threadId), userId: parsedUserId });
      if (!thread) {
        throw new APIError(404, "not_found_thread", "Thread not found", { retriable: false });
      }
      if (!thread.projectId) {
        // Project-less chats stay writable until a workspace-backed tool materializes a project.
        return;
      }
      const state = await getProjectWriteState(tx, {
        projectId: thread.projectId,
        userId: parsedUserId,
      });
      if (!state) {
        throw new APIError(404, "not_found_project", "Project not found", { retriable: false });
      }
      if (state.readOnly) {
        throw new APIError(
          403,
          "permission_plan_required",
          "Project is read-only after downgrade",
          {
            details: {
              archiveAfter: state.archiveAfter?.toISOString() ?? null,
              overQuota: state.overQuota,
            },
            hint: "Delete or archive over-limit projects, or upgrade your plan to continue editing this project.",
            retriable: false,
          },
        );
      }
    });
  } finally {
    await close();
  }
}

export async function requireProjectAccess(
  env: AgentEnv,
  userId: string,
  projectId: string,
  writable: boolean,
): Promise<ProjectSummary & { workspaceSlug: string }> {
  const parsedUserId = UserId(userId);
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    return await withUserContext(db, parsedUserId, async (tx) => {
      const project = await getProject(tx, {
        projectId: ProjectId(projectId),
        userId: parsedUserId,
      });
      if (!project) {
        throw new APIError(404, "not_found_project", "Project not found", { retriable: false });
      }
      if (writable && project.readOnly) {
        throw new APIError(
          403,
          "permission_plan_required",
          "Project is read-only after downgrade",
          {
            details: {
              archiveAfter: project.archiveAfter?.toISOString() ?? null,
              overQuota: project.overQuota,
            },
            hint: "Delete or archive over-limit projects, or upgrade your plan to continue editing this project.",
            retriable: false,
          },
        );
      }
      return {
        ...project,
        archiveAfter: project.archiveAfter?.toISOString() ?? null,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      };
    });
  } finally {
    await close();
  }
}

export function agentRunForRunId(env: AgentEnv, runId: string): DurableObjectStub<AgentRun> {
  return env.AGENT_RUN.get(env.AGENT_RUN.idFromName(runId));
}

interface StartAgentRunInput {
  body: CreateRun;
  modelExplicit: boolean;
  personalization: RunPersonalization;
  run: AgentRunHandle;
  sandboxName: string;
  userId: string;
}

export async function startAgentRun(
  env: AgentEnv,
  input: StartAgentRunInput,
): Promise<AgentRunAdmissionOutcome> {
  const { body, modelExplicit, personalization, run, sandboxName, userId } = input;
  const messageText = extractRunMessageText(body);
  const stub = agentRunForRunId(env, run.runId);
  const startBody = JSON.stringify({
    isFirstRun: Boolean(run.isFirstRun),
    ...(personalization.agentDisplayName
      ? { agentDisplayName: personalization.agentDisplayName }
      : {}),
    ...(personalization.globalMemory ? { globalMemory: personalization.globalMemory } : {}),
    disabledModels: personalization.disabledModels,
    ...(run.importRepoUrl ? { importRepoUrl: run.importRepoUrl } : {}),
    messageText,
    model: run.modelId,
    modelExplicit,
    ...(body.intent ? { runIntent: body.intent } : {}),
    ...(run.projectId ? { projectId: run.projectId } : {}),
    ...(run.workspaceSlug ? { workspaceSlug: run.workspaceSlug } : {}),
    ...(run.projectMode ? { projectMode: run.projectMode } : {}),
    runId: run.runId,
    sandboxName,
    threadId: run.threadId,
    userId,
  });
  const outcome = await attemptAgentRunStart(stub, userId, startBody);
  if (outcome.type === "confirmed") {
    emitRunStartEvents(env, { messageText, response: outcome.response, run, userId });
  }
  return outcome;
}

/** Resolves the run-keyed object without ever treating a transport failure as absence. */
export async function reconcileAgentRunAdmission(
  env: AgentEnv,
  userId: string,
  runId: string,
): Promise<AgentRunAdmissionOutcome> {
  return probeAgentRunAdmission(agentRunForRunId(env, runId), userId);
}

async function attemptAgentRunStart(
  stub: DurableObjectStub<AgentRun>,
  userId: string,
  startBody: string,
): Promise<AgentRunAdmissionOutcome> {
  try {
    const first = await fetchAgentRunStart(stub, startBody);
    if (first.ok) {
      return { response: first, type: "confirmed" };
    }
    await discardResponse(first);
  } catch {
    try {
      const retry = await fetchAgentRunStart(stub, startBody);
      if (retry.ok) {
        return { response: retry, type: "confirmed" };
      }
      await discardResponse(retry);
    } catch {
      // A thrown start may still have reached the object, so only the ordered
      // presence probe below is allowed to classify it as absent.
    }
  }
  return probeAgentRunAdmission(stub, userId);
}

function fetchAgentRunStart(stub: DurableObjectStub<AgentRun>, body: string): Promise<Response> {
  return stub.fetch("https://agent-run.internal/start", { body, method: "POST" });
}

async function probeAgentRunAdmission(
  stub: DurableObjectStub<AgentRun>,
  userId: string,
): Promise<AgentRunAdmissionOutcome> {
  let statusResponse: Response;
  try {
    statusResponse = await stub.fetch("https://agent-run.internal/status", {
      headers: { "X-Cheatcode-User-Id": userId },
    });
  } catch {
    return { type: "ambiguous" };
  }
  if (statusResponse.status === 204) {
    await discardResponse(statusResponse);
    return { type: "absent" };
  }
  if (!statusResponse.ok) {
    await discardResponse(statusResponse);
    return { type: "ambiguous" };
  }
  await discardResponse(statusResponse);
  return reconnectAgentRunStream(stub, userId);
}

async function reconnectAgentRunStream(
  stub: DurableObjectStub<AgentRun>,
  userId: string,
): Promise<AgentRunAdmissionOutcome> {
  try {
    const response = await stub.fetch("https://agent-run.internal/stream?lastSeq=0", {
      headers: { "X-Cheatcode-User-Id": userId },
    });
    if (response.ok) {
      return { response, type: "confirmed" };
    }
    await discardResponse(response);
  } catch {
    return { type: "ambiguous" };
  }
  return { type: "ambiguous" };
}

async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export async function runEntitlementPolicy(
  env: AgentEnv,
  userId: string,
): Promise<RunEntitlementPolicy> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  let entitlement: EntitlementCache;
  let periodEnd: Date;
  try {
    ({ entitlement, periodEnd } = await withUserContext(db, UserId(userId), async (tx) => {
      const loadedEntitlement = entitlementCacheFromValues(
        (await findAgentEntitlementByUserId(tx, UserId(userId))) ?? { tier: "free" },
      );
      return {
        entitlement: loadedEntitlement,
        periodEnd: quotaPeriodEndFor(loadedEntitlement),
      };
    }));
  } finally {
    await close();
  }
  await enforceSandboxHoursGate(env, userId, entitlement, periodEnd);
  return {
    quotaPeriodEnd: periodEnd.toISOString(),
  };
}

export async function syncSandboxQuotaPeriod(
  sandbox: DurableObjectStub<ProjectSandbox>,
  quotaPeriodEnd: string,
): Promise<void> {
  try {
    await sandbox.setQuotaPeriod(quotaPeriodEnd);
  } catch {
    throw quotaTrackerUnavailableError();
  }
}

async function enforceSandboxHoursGate(
  env: AgentEnv,
  userId: string,
  entitlement: EntitlementCache,
  periodEnd: Date,
): Promise<void> {
  const allowanceHours = entitlement.quotaSandboxHours;
  const namespace = env.QUOTA_TRACKER;
  const stub = namespace.get(namespace.idFromName(`quota:${userId}`));
  await syncSandboxHoursLimit(stub, allowanceHours, Date.parse(entitlement.updatedAt));
  const usedHours = await peekSandboxHoursUsed(stub, periodEnd);
  const resetAt = periodEnd.getTime();
  if (usedHours >= allowanceHours) {
    emitSandboxHoursExhausted(env, userId, entitlement.tier, usedHours, allowanceHours);
    throw sandboxHoursExhaustedError(allowanceHours, usedHours, resetAt, entitlement.tier);
  }
}

async function syncSandboxHoursLimit(
  stub: DurableObjectStub,
  allowanceHours: number,
  entitlementVersion: number,
): Promise<void> {
  try {
    const body = QuotaSetLimitRequestSchema.parse({
      entitlementVersion,
      feature: QUOTA_FEATURES.sandboxHours,
      limit: allowanceHours,
    });
    const response = await stub.fetch("https://quota.internal/set-limit", {
      body: JSON.stringify(body),
      method: "POST",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`QuotaTracker set-limit failed with HTTP ${response.status}`);
    }
    QuotaSetLimitResponseSchema.parse(
      await readBoundedResponseJson(response, QUOTA_TRACKER_MAX_RESPONSE_BYTES, "Quota set-limit"),
    );
  } catch {
    throw quotaTrackerUnavailableError();
  }
}

async function peekSandboxHoursUsed(stub: DurableObjectStub, periodEnd: Date): Promise<number> {
  try {
    const body = QuotaPeekRequestSchema.parse({
      feature: QUOTA_FEATURES.sandboxHours,
      periodEnd: periodEnd.toISOString(),
    });
    const response = await stub.fetch("https://quota.internal/peek", {
      body: JSON.stringify(body),
      method: "POST",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`QuotaTracker peek failed with HTTP ${response.status}`);
    }
    return QuotaUsageResponseSchema.parse(
      await readBoundedResponseJson(response, QUOTA_TRACKER_MAX_RESPONSE_BYTES, "Quota tracker"),
    ).used;
  } catch {
    throw quotaTrackerUnavailableError();
  }
}

function quotaTrackerUnavailableError(): APIError {
  return new APIError(503, "unavailable_maintenance", "Quota tracker is unavailable", {
    hint: "Retry the request. If it persists, check the QuotaTracker Durable Object logs.",
    retriable: true,
  });
}

function emitSandboxHoursExhausted(
  env: AgentEnv,
  userId: string,
  tier: string,
  usedHours: number,
  allowanceHours: number,
): void {
  createLogger().warn("run_blocked_sandbox_hours_exhausted", {
    sandboxHoursTotal: allowanceHours,
    sandboxHoursUsed: usedHours,
    tier,
    userId,
  });
  emitUserEvent(env, { eventName: "sandbox_hours_exhausted_block", plan: tier, userId });
}

function sandboxHoursExhaustedError(
  allowanceHours: number,
  usedHours: number,
  resetAt: number,
  tier: string,
): APIError {
  return new APIError(402, "quota_exhausted_sandbox_hours", "Monthly sandbox hours exhausted", {
    details: {
      resetAt: new Date(resetAt).toISOString(),
      sandboxHoursTotal: allowanceHours,
      sandboxHoursUsed: usedHours,
      tier,
    },
    hint: "Upgrade your plan or wait for your monthly sandbox-hour reset.",
    retriable: false,
  });
}

export async function activeRunForThreadRoute(
  env: AgentEnv,
  userId: string,
  threadId: string,
): Promise<AgentRunHandle | null> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    return await withUserContext(db, UserId(userId), (tx) =>
      findActiveAgentRunForThread(tx, {
        threadId: ThreadId(threadId),
        userId: UserId(userId),
      }),
    );
  } finally {
    await close();
  }
}

export async function runForRoute(
  env: AgentEnv,
  userId: string,
  runId: string,
): Promise<AgentRunHandle> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const run = await withUserContext(db, UserId(userId), (tx) =>
      findAgentRunForUser(tx, {
        runId: AgentRunId(runId),
        userId: UserId(userId),
      }),
    );
    if (!run) {
      throw new APIError(404, "not_found_run", "Run not found", { retriable: false });
    }
    return run;
  } finally {
    await close();
  }
}

export function withRunLocation(response: Response, runId: string): Response {
  const wrapped = new Response(response.body, response);
  wrapped.headers.set("Location", `/v1/runs/${runId}`);
  return wrapped;
}

export async function fetchAgentRun(
  stub: DurableObjectStub<AgentRun>,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await stub.fetch(url, init);
  } catch (error) {
    throw agentRunUnavailableError(error);
  }
}

function agentRunUnavailableError(error: unknown): APIError {
  const isFreeTierDuration = isDurableObjectFreeTierDurationError(error);
  return new APIError(503, "unavailable_maintenance", "Agent run service is unavailable", {
    details: {
      reason: isFreeTierDuration
        ? "durable_object_free_tier_duration_exceeded"
        : "agent_run_do_unavailable",
    },
    hint: isFreeTierDuration
      ? "Cloudflare Durable Objects Free duration is exhausted. Enable Workers Paid or wait for the daily Free-tier reset, then retry."
      : "Retry the request. If it persists, check Cloudflare Workers Logs for the AgentRun Durable Object.",
    retriable: true,
  });
}

function isDurableObjectFreeTierDurationError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(DO_FREE_TIER_DURATION_ERROR);
}

function emitRunStartEvents(
  env: AgentEnv,
  input: {
    messageText: string;
    response: Response;
    run: AgentRunHandle;
    userId: string;
  },
): void {
  if (!input.response.ok) {
    return;
  }
  const event = {
    plannedModelId: input.run.modelId,
    promptLength: input.messageText.length,
    runId: input.run.runId,
    userId: input.userId,
  };
  emitUserEvent(env, { ...event, eventName: "run_started" });
  if (input.run.isFirstRun) {
    emitUserEvent(env, { ...event, eventName: "first_run_started" });
  }
}
