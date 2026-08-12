import {
  type EntitlementCache,
  entitlementCacheFromValues,
  quotaPeriodEndFor,
} from "@cheatcode/billing";
import {
  type AgentRunHandle,
  type Database,
  findActiveAgentRunForThread,
  findAgentEntitlementByUserId,
  findAgentRunForUser,
  getProject,
  getThread,
  type RunPersonalization,
  withUserDb,
} from "@cheatcode/db";
import { APIError, createLogger, emitUserEvent } from "@cheatcode/observability";
import { toAgentRunId, toProjectId, toThreadId, toUserId, type UserId } from "@cheatcode/types";
import type { CreateRun, ProjectSummary } from "@cheatcode/types/api";
import { QUOTA_FEATURES } from "@cheatcode/types/quota";
import type { AgentEnv } from "./agent-env";
import type { AgentRun } from "./durable-objects/agent-run";
import { type StartRunInput, StartRunInputSchema } from "./durable-objects/agent-run-schemas";
import type { ProjectSandbox } from "./durable-objects/project-sandbox";
import type { QuotaTrackerStub } from "./quota-tracker-binding";
import { extractRunMessageText } from "./run-request";
import { userSandboxName } from "./tenancy";

const DO_FREE_TIER_DURATION_ERROR = "Exceeded allowed duration in Durable Objects free tier";

export interface RunEntitlementPolicy {
  quotaPeriodEnd: string;
}

export interface RunEntitlementSnapshot {
  entitlement: EntitlementCache;
  periodEnd: Date;
}

export type AgentRunAdmissionOutcome =
  | { response: Response; kind: "confirmed" }
  | { kind: "absent" }
  | { kind: "ambiguous" };

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
): Promise<{ id: string; name: string; workspaceSlug: string } | null> {
  const parsedUserId = toUserId(userId);
  return withUserDb(env, parsedUserId, async ({ transaction }) => {
    return transaction(async (tx) => {
      const thread = await getThread(tx, { threadId: toThreadId(threadId), userId: parsedUserId });
      if (!thread) {
        throw new APIError(404, "resource_thread_not_found", "Thread not found", {
          retriable: false,
        });
      }
      if (!thread.projectId) {
        // Project-less chats stay writable until a workspace-backed tool materializes a project.
        return null;
      }
      const project = await getProject(tx, {
        projectId: thread.projectId,
        userId: parsedUserId,
      });
      if (!project) {
        throw new APIError(404, "resource_project_not_found", "Project not found", {
          retriable: false,
        });
      }
      if (project.readOnly) {
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
      return { id: project.id, name: project.name, workspaceSlug: project.workspaceSlug };
    });
  });
}

export async function requireProjectAccess(
  env: AgentEnv,
  userId: string,
  projectId: string,
  writable: boolean,
): Promise<ProjectSummary & { workspaceSlug: string }> {
  const parsedUserId = toUserId(userId);
  return withUserDb(env, parsedUserId, async ({ transaction }) => {
    return await transaction(async (tx) => {
      const project = await getProject(tx, {
        projectId: toProjectId(projectId),
        userId: parsedUserId,
      });
      if (!project) {
        throw new APIError(404, "resource_project_not_found", "Project not found", {
          retriable: false,
        });
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
  });
}

export function agentRunForRunId(env: AgentEnv, runId: string): DurableObjectStub<AgentRun> {
  return env.AGENT_RUN.get(env.AGENT_RUN.idFromName(runId));
}

interface StartAgentRunInput {
  body: CreateRun;
  isModelExplicit: boolean;
  personalization: RunPersonalization;
  run: AgentRunHandle;
  sandboxName: string;
  userId: string;
}

export async function startAgentRun(
  env: AgentEnv,
  input: StartAgentRunInput,
): Promise<AgentRunAdmissionOutcome> {
  const { body, isModelExplicit, personalization, run, sandboxName, userId } = input;
  const messageText = extractRunMessageText(body);
  const stub = agentRunForRunId(env, run.runId);
  const startInput = StartRunInputSchema.parse({
    isFirstRun: Boolean(run.isFirstRun),
    ...(personalization.agentDisplayName
      ? { agentDisplayName: personalization.agentDisplayName }
      : {}),
    ...(personalization.globalMemory ? { globalMemory: personalization.globalMemory } : {}),
    disabledModels: personalization.disabledModels,
    ...(run.importRepoUrl ? { importRepoUrl: run.importRepoUrl } : {}),
    messageText,
    model: run.modelId,
    isModelExplicit,
    ...(body.intent ? { runIntent: body.intent } : {}),
    ...(body.selectedSkill ? { selectedSkill: body.selectedSkill } : {}),
    ...(body.selectedTool ? { selectedTool: body.selectedTool } : {}),
    ...(run.projectId ? { projectId: run.projectId } : {}),
    ...(run.workspaceSlug ? { workspaceSlug: run.workspaceSlug } : {}),
    ...(run.projectMode ? { projectMode: run.projectMode } : {}),
    runId: run.runId,
    sandboxName,
    threadId: run.threadId,
    userId,
  });
  const outcome = await attemptAgentRunStart(stub, userId, startInput);
  if (outcome.kind === "confirmed") {
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
  startInput: StartRunInput,
): Promise<AgentRunAdmissionOutcome> {
  try {
    const first = await stub.start(startInput);
    if (first.ok) {
      return { response: first, kind: "confirmed" };
    }
    await discardResponse(first);
  } catch {
    try {
      const retry = await stub.start(startInput);
      if (retry.ok) {
        return { response: retry, kind: "confirmed" };
      }
      await discardResponse(retry);
    } catch {
      // A thrown start may still have reached the object, so only the ordered
      // presence probe below is allowed to classify it as absent.
    }
  }
  return probeAgentRunAdmission(stub, userId);
}

async function probeAgentRunAdmission(
  stub: DurableObjectStub<AgentRun>,
  userId: string,
): Promise<AgentRunAdmissionOutcome> {
  let statusResponse: Response;
  try {
    statusResponse = await stub.status(userId);
  } catch {
    return { kind: "ambiguous" };
  }
  if (statusResponse.status === 204) {
    await discardResponse(statusResponse);
    return { kind: "absent" };
  }
  if (!statusResponse.ok) {
    await discardResponse(statusResponse);
    return { kind: "ambiguous" };
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
      return { response, kind: "confirmed" };
    }
    await discardResponse(response);
  } catch {
    return { kind: "ambiguous" };
  }
  return { kind: "ambiguous" };
}

async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export async function loadRunEntitlementPolicy(
  db: Database,
  userId: UserId,
): Promise<RunEntitlementSnapshot> {
  const entitlement = entitlementCacheFromValues(
    (await findAgentEntitlementByUserId(db, userId)) ?? { tier: "free" },
  );
  return {
    entitlement,
    periodEnd: quotaPeriodEndFor(entitlement),
  };
}

export async function enforceRunEntitlementPolicy(
  env: AgentEnv,
  userId: string,
  snapshot: RunEntitlementSnapshot,
): Promise<RunEntitlementPolicy> {
  await enforceSandboxHoursGate(env, userId, snapshot.entitlement, snapshot.periodEnd);
  return {
    quotaPeriodEnd: snapshot.periodEnd.toISOString(),
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
  stub: QuotaTrackerStub,
  allowanceHours: number,
  entitlementVersion: number,
): Promise<void> {
  try {
    await stub.setLimit(QUOTA_FEATURES.sandboxHours, allowanceHours, entitlementVersion);
  } catch {
    throw quotaTrackerUnavailableError();
  }
}

async function peekSandboxHoursUsed(stub: QuotaTrackerStub, periodEnd: Date): Promise<number> {
  try {
    return (await stub.peek(QUOTA_FEATURES.sandboxHours, periodEnd)).used;
  } catch {
    throw quotaTrackerUnavailableError();
  }
}

function quotaTrackerUnavailableError(): APIError {
  return new APIError(503, "service_maintenance_unavailable", "Quota tracker is unavailable", {
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
  return new APIError(402, "quota_sandbox_hours_exhausted", "Monthly sandbox hours exhausted", {
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
  return withUserDb(env, toUserId(userId), async ({ transaction }) => {
    return await transaction((tx) =>
      findActiveAgentRunForThread(tx, {
        threadId: toThreadId(threadId),
        userId: toUserId(userId),
      }),
    );
  });
}

export async function runForRoute(
  env: AgentEnv,
  userId: string,
  runId: string,
): Promise<AgentRunHandle> {
  return withUserDb(env, toUserId(userId), async ({ transaction }) => {
    const run = await transaction((tx) =>
      findAgentRunForUser(tx, {
        runId: toAgentRunId(runId),
        userId: toUserId(userId),
      }),
    );
    if (!run) {
      throw new APIError(404, "resource_run_not_found", "Run not found", { retriable: false });
    }
    return run;
  });
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

export async function callAgentRun(operation: Promise<Response>): Promise<Response> {
  try {
    return await operation;
  } catch (error) {
    throw agentRunUnavailableError(error);
  }
}

function agentRunUnavailableError(error: unknown): APIError {
  const isFreeTierDuration = isDurableObjectFreeTierDurationError(error);
  return new APIError(503, "service_maintenance_unavailable", "Agent run service is unavailable", {
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
