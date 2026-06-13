import {
  type EntitlementCache,
  entitlementCacheFromValues,
  quotaPeriodEndFor,
  tierLimits,
} from "@cheatcode/billing";
import {
  type AgentRunHandle,
  createDb,
  findActiveAgentRunForThread,
  findAgentRunForUser,
  findEntitlementByUserId,
  getProjectWriteState,
  getThread,
  getUserDailyUsageCostUsd,
  type RunPersonalization,
  withUserContext,
} from "@cheatcode/db";
import { APIError, createLogger, emitUserEvent } from "@cheatcode/observability";
import { AgentRunId, type CreateRun, ProjectId, ThreadId, UserId } from "@cheatcode/types";
import { z } from "zod";
import type { AgentRun } from "./durable-objects/agent-run";
import { DEFAULT_RUN_BUDGET_CAP_USD } from "./durable-objects/agent-run-budget";
import type { ProjectSandbox } from "./durable-objects/project-sandbox";
import type { AgentEnv } from "./index";
import { extractRunMessageText } from "./run-request";
import {
  agentRunObjectName,
  isUuidRouteParam,
  legacyAgentRunObjectName,
  projectSandboxName,
} from "./tenancy";

const DO_FREE_TIER_DURATION_ERROR = "Exceeded allowed duration in Durable Objects free tier";
const MAX_RESEARCH_FANOUT_SUBAGENTS = 25;
const SANDBOX_HOURS_FEATURE = "sandbox_hours";
const SANDBOX_HOURS_WARN_RATIO = 0.8;

const QuotaPeekResultSchema = z
  .object({
    limit: z.number().finite().nonnegative(),
    remaining: z.number().finite().nonnegative(),
    used: z.number().finite().nonnegative(),
  })
  .strict();

export interface SandboxHoursQuotaWarning {
  feature: "sandbox_hours";
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface RunEntitlementPolicy {
  dailyCostCapUsd?: number;
  dailyCostUsdAtRunStart: number;
  maxConcurrentSandboxes: number;
  quotaPeriodEnd: string;
  quotaWarning?: SandboxHoursQuotaWarning;
  researchFanoutSubagentLimit: number;
}

export async function sandboxForThread(
  env: AgentEnv,
  userId: string,
  threadId: string,
): Promise<DurableObjectStub<ProjectSandbox>> {
  if (!isUuidRouteParam(threadId)) {
    return sandboxForLegacyThread(env, userId, threadId);
  }
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const thread = await withUserContext(db, UserId(userId), (tx) =>
      getThread(tx, { threadId: ThreadId(threadId), userId: UserId(userId) }),
    );
    if (!thread) {
      throw new APIError(404, "not_found_thread", "Thread not found", { retriable: false });
    }
    return sandboxForProject(env, userId, thread.projectId);
  } finally {
    await close();
  }
}

export async function sandboxForProject(
  env: AgentEnv,
  userId: string,
  projectId: string,
): Promise<DurableObjectStub<ProjectSandbox>> {
  const sandboxName = await projectSandboxName(userId, projectId);
  const sandbox = env.PROJECT_SANDBOX.get(env.PROJECT_SANDBOX.idFromName(sandboxName));
  await sandbox.registerOwner(userId);
  return sandbox;
}

export async function requireWritableThreadProject(
  env: AgentEnv,
  userId: string,
  threadId: string,
): Promise<void> {
  if (!isUuidRouteParam(threadId)) {
    return;
  }
  const parsedUserId = UserId(userId);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    await withUserContext(db, parsedUserId, async (tx) => {
      const thread = await getThread(tx, { threadId: ThreadId(threadId), userId: parsedUserId });
      if (!thread) {
        throw new APIError(404, "not_found_thread", "Thread not found", { retriable: false });
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

export function agentRunForRunId(env: AgentEnv, runId: string): DurableObjectStub<AgentRun> {
  return env.AGENT_RUN.get(env.AGENT_RUN.idFromName(agentRunObjectName(runId)));
}

export async function startAgentRun(
  env: AgentEnv,
  userId: string,
  run: AgentRunHandle,
  body: CreateRun,
  sandboxName: string,
  policy: RunEntitlementPolicy,
  personalization: RunPersonalization,
): Promise<Response> {
  const messageText = extractRunMessageText(body);
  const response = await fetchAgentRun(
    agentRunForRunId(env, run.runId),
    "https://agent-run.internal/start",
    {
      method: "POST",
      body: JSON.stringify({
        budgetCapUsd: body.budgetCapUsd ?? run.budgetCapUsd ?? DEFAULT_RUN_BUDGET_CAP_USD,
        isFirstRun: Boolean(run.isFirstRun),
        dailyCostUsdAtRunStart: policy.dailyCostUsdAtRunStart,
        ...(policy.dailyCostCapUsd === undefined
          ? {}
          : { dailyCostCapUsd: policy.dailyCostCapUsd }),
        ...(run.masterInstructions ? { masterInstructions: run.masterInstructions } : {}),
        ...(personalization.agentDisplayName
          ? { agentDisplayName: personalization.agentDisplayName }
          : {}),
        ...(personalization.globalMemory ? { globalMemory: personalization.globalMemory } : {}),
        disabledModels: personalization.disabledModels,
        ...(run.importRepoUrl ? { importRepoUrl: run.importRepoUrl } : {}),
        messageText,
        model: body.model ?? run.modelId,
        projectId: run.projectId,
        ...(run.projectMode ? { projectMode: run.projectMode } : {}),
        ...(policy.quotaWarning ? { quotaWarning: policy.quotaWarning } : {}),
        runId: run.runId,
        sandboxName,
        threadId: run.threadId,
        userId,
        researchFanoutSubagentLimit: policy.researchFanoutSubagentLimit,
      }),
    },
  );
  emitRunStartEvents(env, { body, messageText, response, run, userId });
  return response;
}

export async function runEntitlementPolicy(
  env: AgentEnv,
  userId: string,
): Promise<RunEntitlementPolicy> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    return await withUserContext(db, UserId(userId), async (tx) => {
      const entitlement = entitlementCacheFromValues(
        (await findEntitlementByUserId(tx, UserId(userId))) ?? { tier: "free" },
      );
      const limits = tierLimits(entitlement.tier);
      const dailyCostUsdAtRunStart = await getUserDailyUsageCostUsd(tx, {
        day: currentUtcDay(),
        userId: UserId(userId),
      });
      if (limits.dailyCostCapUsd !== null && dailyCostUsdAtRunStart >= limits.dailyCostCapUsd) {
        throw dailyCostCapError(limits.dailyCostCapUsd, dailyCostUsdAtRunStart, entitlement.tier);
      }
      const periodEnd = quotaPeriodEndFor(entitlement);
      const quotaWarning = await evaluateSandboxHoursGate(env, userId, entitlement, periodEnd);
      return {
        dailyCostUsdAtRunStart,
        ...(limits.dailyCostCapUsd === null ? {} : { dailyCostCapUsd: limits.dailyCostCapUsd }),
        maxConcurrentSandboxes: entitlement.maxConcurrentSandboxes,
        quotaPeriodEnd: periodEnd.toISOString(),
        ...(quotaWarning ? { quotaWarning } : {}),
        researchFanoutSubagentLimit: Math.min(
          limits.researchFanoutSubagents ?? MAX_RESEARCH_FANOUT_SUBAGENTS,
          MAX_RESEARCH_FANOUT_SUBAGENTS,
        ),
      };
    });
  } finally {
    await close();
  }
}

export async function syncSandboxQuotaPeriod(
  sandbox: DurableObjectStub<ProjectSandbox>,
  quotaPeriodEnd: string,
): Promise<void> {
  try {
    await sandbox.setQuotaPeriod(quotaPeriodEnd);
  } catch (error) {
    createLogger().warn("sandbox_quota_period_sync_failed", {
      error: error instanceof Error ? error.message : "Unknown setQuotaPeriod error",
    });
  }
}

async function evaluateSandboxHoursGate(
  env: AgentEnv,
  userId: string,
  entitlement: EntitlementCache,
  periodEnd: Date,
): Promise<SandboxHoursQuotaWarning | undefined> {
  const namespace = env.QUOTA_TRACKER;
  const allowanceHours = entitlement.quotaSandboxHours;
  if (!namespace || !(allowanceHours > 0)) {
    return undefined;
  }
  const stub = namespace.get(namespace.idFromName(`quota:${userId}`));
  await syncSandboxHoursLimit(stub, allowanceHours);
  const usedHours = await peekSandboxHoursUsed(stub, periodEnd);
  if (usedHours === null) {
    return undefined;
  }
  const resetAt = periodEnd.getTime();
  if (usedHours >= allowanceHours) {
    emitSandboxHoursExhausted(env, userId, entitlement.tier, usedHours, allowanceHours);
    throw sandboxHoursExhaustedError(allowanceHours, usedHours, resetAt, entitlement.tier);
  }
  if (usedHours / allowanceHours >= SANDBOX_HOURS_WARN_RATIO) {
    emitUserEvent(env, { eventName: "sandbox_hours_warn_emitted", plan: entitlement.tier, userId });
    return {
      feature: SANDBOX_HOURS_FEATURE,
      limit: allowanceHours,
      remaining: Math.max(0, allowanceHours - usedHours),
      resetAt,
    };
  }
  return undefined;
}

async function syncSandboxHoursLimit(
  stub: DurableObjectStub,
  allowanceHours: number,
): Promise<void> {
  try {
    const response = await stub.fetch("https://quota.internal/set-limit", {
      body: JSON.stringify({
        feature: SANDBOX_HOURS_FEATURE,
        limit: allowanceHours,
        source: "agent-worker-entitlement",
      }),
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`QuotaTracker set-limit failed with HTTP ${response.status}`);
    }
  } catch (error) {
    createLogger().warn("sandbox_hours_limit_sync_failed", {
      error: error instanceof Error ? error.message : "Unknown quota set-limit error",
    });
  }
}

async function peekSandboxHoursUsed(
  stub: DurableObjectStub,
  periodEnd: Date,
): Promise<number | null> {
  try {
    const response = await stub.fetch("https://quota.internal/peek", {
      body: JSON.stringify({
        feature: SANDBOX_HOURS_FEATURE,
        periodEnd: periodEnd.toISOString(),
      }),
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`QuotaTracker peek failed with HTTP ${response.status}`);
    }
    return QuotaPeekResultSchema.parse(await response.json()).used;
  } catch (error) {
    createLogger().warn("sandbox_hours_peek_failed_open", {
      error: error instanceof Error ? error.message : "Unknown quota peek error",
    });
    return null;
  }
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

function dailyCostCapError(capUsd: number, spentUsd: number, tier: string): APIError {
  return new APIError(402, "daily_cost_cap_reached", "Daily cost cap reached", {
    details: { capUsd, spentUsd, tier },
    hint: "Wait for the UTC daily reset or upgrade your plan before starting another run.",
    retriable: false,
  });
}

export async function startLegacyThreadRun(
  env: AgentEnv,
  userId: string,
  threadId: string,
  body: CreateRun,
): Promise<Response> {
  const runId = legacyAgentRunObjectName(userId, threadId);
  const projectId = await projectSandboxName(userId, threadId);
  const policy = await runEntitlementPolicy(env, userId);
  await sandboxForLegacyThread(env, userId, threadId);
  return fetchAgentRun(
    agentRunForLegacyThread(env, userId, threadId),
    "https://agent-run.internal/start",
    {
      method: "POST",
      body: JSON.stringify({
        budgetCapUsd: body.budgetCapUsd ?? DEFAULT_RUN_BUDGET_CAP_USD,
        dailyCostUsdAtRunStart: policy.dailyCostUsdAtRunStart,
        ...(policy.dailyCostCapUsd === undefined
          ? {}
          : { dailyCostCapUsd: policy.dailyCostCapUsd }),
        disabledModels: [],
        messageText: extractRunMessageText(body),
        model: body.model,
        projectId,
        runId,
        sandboxName: projectId,
        threadId,
        userId,
      }),
    },
  );
}

export async function activeRunForThreadRoute(
  env: AgentEnv,
  userId: string,
  threadId: string,
): Promise<AgentRunHandle | null> {
  if (!isUuidRouteParam(threadId)) {
    return legacyRunHandle(userId, threadId);
  }
  const { db, close } = createDb(env.HYPERDRIVE);
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
  if (!isUuidRouteParam(runId)) {
    return legacyRunHandle(userId, runId);
  }
  const { db, close } = createDb(env.HYPERDRIVE);
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

export async function saveTakeoverState(
  env: AgentEnv,
  userId: string,
  runId: string,
  state: { expiresAt: number; resumeToken: string },
): Promise<Response> {
  return fetchAgentRun(agentRunForRunId(env, runId), "https://agent-run.internal/takeover-state", {
    method: "POST",
    body: JSON.stringify({ ...state, userId }),
  });
}

export async function consumeTakeoverState(
  env: AgentEnv,
  userId: string,
  runId: string,
  resumeToken: string,
): Promise<Response> {
  return fetchAgentRun(agentRunForRunId(env, runId), "https://agent-run.internal/resume-takeover", {
    method: "POST",
    body: JSON.stringify({ resumeToken, userId }),
  });
}

async function sandboxForLegacyThread(
  env: AgentEnv,
  userId: string,
  threadId: string,
): Promise<DurableObjectStub<ProjectSandbox>> {
  const sandboxName = await projectSandboxName(userId, threadId);
  const sandbox = env.PROJECT_SANDBOX.get(env.PROJECT_SANDBOX.idFromName(sandboxName));
  await sandbox.registerOwner(userId);
  return sandbox;
}

function agentRunForLegacyThread(
  env: AgentEnv,
  userId: string,
  threadId: string,
): DurableObjectStub<AgentRun> {
  return env.AGENT_RUN.get(env.AGENT_RUN.idFromName(legacyAgentRunObjectName(userId, threadId)));
}

function legacyRunHandle(userId: string, threadId: string): AgentRunHandle {
  return {
    projectId: ProjectId(threadId),
    runId: AgentRunId(legacyAgentRunObjectName(userId, threadId)),
    status: "running",
    threadId: ThreadId(threadId),
  };
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

function currentUtcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function emitRunStartEvents(
  env: AgentEnv,
  input: {
    body: CreateRun;
    messageText: string;
    response: Response;
    run: AgentRunHandle;
    userId: string;
  },
): void {
  if (!input.response.ok) {
    return;
  }
  const model = input.body.model ?? input.run.modelId;
  const event = {
    ...(model ? { model } : {}),
    promptLength: input.messageText.length,
    runId: input.run.runId,
    userId: input.userId,
  };
  emitUserEvent(env, { ...event, eventName: "run_started" });
  if (input.run.isFirstRun) {
    emitUserEvent(env, { ...event, eventName: "first_run_started" });
  }
}
