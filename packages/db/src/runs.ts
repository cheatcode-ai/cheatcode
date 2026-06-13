import type { AgentRunId, ProjectId, ThreadId, UserId } from "@cheatcode/types";
import {
  AGENT_MODEL_CATALOG,
  PRODUCTION_DEFAULT_MODEL_ID,
  AgentRunId as toAgentRunId,
  ProjectId as toProjectId,
  ThreadId as toThreadId,
} from "@cheatcode/types";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import type { RunPersonalization } from "./profiles";
import { attachProjectSandboxWithLimit } from "./projects";
import {
  type AgentRunConfig,
  type AgentRunError,
  agentRuns,
  type ProjectSettings,
  projects,
  threads,
  usageEvents,
} from "./schema";

type ProjectMode = "app-builder" | "app-builder-mobile" | "general";

export type AgentRunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "canceled";

const DEFAULT_RUN_BUDGET_CAP_USD = 5;

export interface AgentRunHandle {
  budgetCapUsd?: number;
  importRepoUrl?: string;
  isFirstRun?: boolean;
  masterInstructions?: string;
  modelId?: string;
  projectMode?: "app-builder" | "app-builder-mobile" | "general";
  projectId: ProjectId;
  runId: AgentRunId;
  status: AgentRunStatus;
  threadId: ThreadId;
}

export interface CreateAgentRunInput {
  agentName: string;
  budgetCapUsd?: number;
  maxConcurrentSandboxes?: number;
  modelId?: string;
  personalization?: RunPersonalization;
  sandboxId?: string;
  source: "web" | "api";
  threadId: ThreadId;
  userId: UserId;
}

export type CreateAgentRunResult =
  | { run: AgentRunHandle; type: "created" }
  | { type: "thread-not-found" }
  | { archiveAfter: Date | null; type: "project-read-only" }
  | { limit: number; sandboxCount: number; type: "sandbox-limit-reached" }
  | { run: AgentRunHandle; type: "active-run-exists" };

export interface UpdateAgentRunStatusInput {
  error?: AgentRunError;
  runId: AgentRunId;
  status: AgentRunStatus;
  userId: UserId;
}

export interface RecordAgentRunUsageInput {
  agentRunId: AgentRunId;
  costUsd: number;
  eventType: string;
  inputTokens: number;
  model?: string;
  outputTokens: number;
  provider?: string;
  userId: UserId;
}

interface ThreadForRunRow {
  activeRunId: string | null;
  archiveAfter: Date | null;
  archivedPendingAction: boolean;
  id: string;
  masterInstructions: string | null;
  overQuota: boolean;
  projectId: string;
  projectMode: "app-builder" | "app-builder-mobile" | "general";
  projectSettings: ProjectSettings;
}

interface CreatedRunRow {
  id: string;
  status: string;
}

export async function createAgentRunForThread(
  db: Database,
  input: CreateAgentRunInput,
): Promise<CreateAgentRunResult> {
  return db.transaction(async (tx) => {
    const thread = await findThreadForRun(tx as Database, input);
    if (!thread) {
      return { type: "thread-not-found" };
    }
    const blockedResult = await blockedRunCreationResult(tx as Database, input, thread);
    if (blockedResult) {
      return blockedResult;
    }
    const attachResult = await attachSandboxForRun(tx as Database, input, thread);
    if (attachResult) {
      return attachResult;
    }

    const budgetCapUsd = resolveRunBudgetCap(
      input.budgetCapUsd,
      thread.projectSettings,
      input.personalization,
      thread.projectMode,
    );
    const modelId = resolveRunModelId(
      input.modelId,
      thread.projectSettings,
      input.personalization,
      thread.projectMode,
    );
    const isFirstRun = await isFirstAgentRunForUser(tx as Database, input.userId);
    const config = agentRunConfig({
      ...input,
      ...(budgetCapUsd === undefined ? {} : { budgetCapUsd }),
    });
    const created = await insertPendingRun(tx as Database, input, config, modelId);
    const activated = await activateCreatedRun(tx as Database, input, created.id);
    if (!activated) {
      await cancelSupersededRun(tx as Database, created.id);
      const active = await findActiveAgentRunForThread(tx as Database, {
        threadId: input.threadId,
        userId: input.userId,
      });
      if (!active) {
        throw new Error("Thread active run changed but could not be resolved");
      }
      return { run: active, type: "active-run-exists" };
    }

    return {
      run: createdRunHandle(thread, config, modelId, created, isFirstRun),
      type: "created",
    };
  });
}

async function blockedRunCreationResult(
  db: Database,
  input: CreateAgentRunInput,
  thread: ThreadForRunRow,
): Promise<CreateAgentRunResult | null> {
  if (thread.activeRunId) {
    return {
      run: await activeRunHandle(db, {
        projectId: thread.projectId,
        runId: thread.activeRunId,
        threadId: thread.id,
        userId: input.userId,
      }),
      type: "active-run-exists",
    };
  }
  if (thread.archivedPendingAction || thread.overQuota) {
    return { archiveAfter: thread.archiveAfter, type: "project-read-only" };
  }
  return null;
}

async function attachSandboxForRun(
  db: Database,
  input: CreateAgentRunInput,
  thread: ThreadForRunRow,
): Promise<CreateAgentRunResult | null> {
  if (!input.sandboxId || input.maxConcurrentSandboxes === undefined) {
    return null;
  }
  const result = await attachProjectSandboxWithLimit(db, {
    maxConcurrentSandboxes: input.maxConcurrentSandboxes,
    projectId: toProjectId(thread.projectId),
    sandboxId: input.sandboxId,
    userId: input.userId,
  });
  if (result.type === "limit-reached") {
    return {
      limit: result.limit,
      sandboxCount: result.sandboxCount,
      type: "sandbox-limit-reached",
    };
  }
  return result.type === "project-not-found" ? { type: "thread-not-found" } : null;
}

function createdRunHandle(
  thread: ThreadForRunRow,
  config: AgentRunConfig,
  modelId: string | undefined,
  created: CreatedRunRow,
  isFirstRun: boolean,
): AgentRunHandle {
  return {
    projectId: toProjectId(thread.projectId),
    ...(config.budgetCapUsd === undefined ? {} : { budgetCapUsd: config.budgetCapUsd }),
    ...(thread.projectSettings.importRepoUrl
      ? { importRepoUrl: thread.projectSettings.importRepoUrl }
      : {}),
    ...(isFirstRun ? { isFirstRun } : {}),
    ...(thread.masterInstructions ? { masterInstructions: thread.masterInstructions } : {}),
    ...(modelId === undefined ? {} : { modelId }),
    projectMode: thread.projectMode,
    runId: toAgentRunId(created.id),
    status: toAgentRunStatus(created.status),
    threadId: toThreadId(thread.id),
  };
}

async function isFirstAgentRunForUser(db: Database, userId: UserId): Promise<boolean> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(eq(agentRuns.userId, userId));
  return Number(rows[0]?.count ?? 0) === 0;
}

async function findThreadForRun(
  db: Database,
  input: CreateAgentRunInput,
): Promise<ThreadForRunRow | null> {
  const [thread] = await db
    .select({
      activeRunId: threads.activeRunId,
      archiveAfter: projects.archiveAfter,
      archivedPendingAction: projects.archivedPendingAction,
      id: threads.id,
      masterInstructions: projects.masterInstructions,
      overQuota: projects.overQuota,
      projectId: threads.projectId,
      projectMode: projects.mode,
      projectSettings: projects.settings,
    })
    .from(threads)
    .innerJoin(projects, eq(projects.id, threads.projectId))
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.userId, input.userId),
        eq(projects.userId, input.userId),
        isNull(threads.deletedAt),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  return thread ? { ...thread, projectMode: projectModeFromDb(thread.projectMode) } : null;
}

async function insertPendingRun(
  db: Database,
  input: CreateAgentRunInput,
  config: AgentRunConfig,
  modelId: string | undefined,
): Promise<CreatedRunRow> {
  const rows = await db
    .insert(agentRuns)
    .values({
      config,
      ...(modelId ? { modelId } : {}),
      status: "pending",
      threadId: input.threadId,
      userId: input.userId,
    })
    .returning({ id: agentRuns.id, status: agentRuns.status });
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create agent run");
  }
  return created;
}

async function activateCreatedRun(
  db: Database,
  input: CreateAgentRunInput,
  runId: string,
): Promise<boolean> {
  const rows = await db
    .update(threads)
    .set({ activeRunId: runId, updatedAt: sql`now()` })
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.userId, input.userId),
        isNull(threads.activeRunId),
        isNull(threads.deletedAt),
      ),
    )
    .returning({ id: threads.id });
  return Boolean(rows[0]);
}

async function cancelSupersededRun(db: Database, runId: string): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      error: {
        message: "A run became active before this run could start.",
        type: "conflict_run_already_active",
      },
      finishedAt: sql`now()`,
      status: "canceled",
    })
    .where(eq(agentRuns.id, runId));
}

export function surfaceOf(projectMode: ProjectMode): "appbuilder" | "general" {
  return projectMode === "general" ? "general" : "appbuilder";
}

export function resolveRunBudgetCap(
  inputBudgetCapUsd: number | undefined,
  projectSettings: ProjectSettings,
  personalization?: RunPersonalization,
  projectMode: ProjectMode = "general",
): number {
  const surfaceBudget = personalization ? surfaceBudgetDefault(personalization, projectMode) : null;
  // A null surface budget ("No cap") falls through to the production default (D8); it does not lift the cap.
  return (
    inputBudgetCapUsd ?? projectSettings.budgetCapUsd ?? surfaceBudget ?? DEFAULT_RUN_BUDGET_CAP_USD
  );
}

export function resolveRunModelId(
  inputModelId: string | undefined,
  projectSettings: ProjectSettings,
  personalization?: RunPersonalization,
  projectMode: ProjectMode = "general",
): string | undefined {
  const explicit = cleanModelId(inputModelId);
  if (explicit) {
    // An explicitly-disabled model is rejected pre-resolution (400); pass the pick through unchanged.
    return explicit;
  }
  const disabled = new Set(personalization?.disabledModels ?? []);
  const surfaceDefault = personalization ? surfaceModelDefault(personalization, projectMode) : null;
  for (const candidate of [
    cleanModelId(projectSettings.defaultModel),
    cleanModelId(surfaceDefault),
  ]) {
    if (candidate && !disabled.has(candidate)) {
      return candidate;
    }
  }
  // "Auto": let the DO fall back to the production default unless the user disabled it.
  if (!disabled.has(PRODUCTION_DEFAULT_MODEL_ID)) {
    return undefined;
  }
  return AGENT_MODEL_CATALOG.find((entry) => !disabled.has(entry.id))?.id;
}

function surfaceModelDefault(
  personalization: RunPersonalization,
  projectMode: ProjectMode,
): string | null {
  return surfaceOf(projectMode) === "general"
    ? personalization.generalDefaultModel
    : personalization.appbuilderDefaultModel;
}

function surfaceBudgetDefault(
  personalization: RunPersonalization,
  projectMode: ProjectMode,
): number | null {
  return surfaceOf(projectMode) === "general"
    ? personalization.generalDefaultBudgetUsd
    : personalization.appbuilderDefaultBudgetUsd;
}

function cleanModelId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export async function findActiveAgentRunForThread(
  db: Database,
  input: { threadId: ThreadId; userId: UserId },
): Promise<AgentRunHandle | null> {
  const rows = await db
    .select({
      modelId: agentRuns.modelId,
      projectId: threads.projectId,
      projectMode: projects.mode,
      runId: agentRuns.id,
      status: agentRuns.status,
      threadId: threads.id,
    })
    .from(threads)
    .innerJoin(agentRuns, eq(agentRuns.id, threads.activeRunId))
    .innerJoin(projects, eq(projects.id, threads.projectId))
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.userId, input.userId),
        eq(agentRuns.userId, input.userId),
        eq(projects.userId, input.userId),
        isNull(threads.deletedAt),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? agentRunHandleFromRow(row) : null;
}

export async function findAgentRunForUser(
  db: Database,
  input: { runId: AgentRunId; userId: UserId },
): Promise<AgentRunHandle | null> {
  const rows = await db
    .select({
      modelId: agentRuns.modelId,
      projectId: threads.projectId,
      projectMode: projects.mode,
      runId: agentRuns.id,
      status: agentRuns.status,
      threadId: agentRuns.threadId,
    })
    .from(agentRuns)
    .innerJoin(threads, eq(threads.id, agentRuns.threadId))
    .innerJoin(projects, eq(projects.id, threads.projectId))
    .where(
      and(
        eq(agentRuns.id, input.runId),
        eq(agentRuns.userId, input.userId),
        eq(threads.userId, input.userId),
        eq(projects.userId, input.userId),
        isNull(threads.deletedAt),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? agentRunHandleFromRow(row) : null;
}

export async function updateAgentRunStatus(
  db: Database,
  input: UpdateAgentRunStatusInput,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updateRows = await tx
      .update(agentRuns)
      .set({
        ...(input.error ? { error: input.error } : {}),
        ...(isTerminalRunStatus(input.status) ? { finishedAt: sql`now()` } : {}),
        status: input.status,
      })
      .where(and(eq(agentRuns.id, input.runId), eq(agentRuns.userId, input.userId)))
      .returning({ threadId: agentRuns.threadId });
    const updated = updateRows[0];
    if (!updated) {
      return false;
    }
    if (isTerminalRunStatus(input.status)) {
      await tx
        .update(threads)
        .set({ activeRunId: null, updatedAt: sql`now()` })
        .where(
          and(
            eq(threads.id, updated.threadId),
            eq(threads.userId, input.userId),
            eq(threads.activeRunId, input.runId),
          ),
        );
    }
    return true;
  });
}

export async function recordAgentRunUsage(
  db: Database,
  input: RecordAgentRunUsageInput,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const costUsd = normalizedCost(input.costUsd);
    await tx.insert(usageEvents).values({
      agentRunId: input.agentRunId,
      costUsd,
      eventType: input.eventType,
      inputTokens: input.inputTokens,
      ...(input.model ? { model: input.model } : {}),
      outputTokens: input.outputTokens,
      ...(input.provider ? { provider: input.provider } : {}),
      userId: input.userId,
    });

    const updatedRows = await tx
      .update(agentRuns)
      .set({
        costUsd: sql`${agentRuns.costUsd} + ${costUsd}`,
        tokensIn: sql`${agentRuns.tokensIn} + ${input.inputTokens}`,
        tokensOut: sql`${agentRuns.tokensOut} + ${input.outputTokens}`,
      })
      .where(and(eq(agentRuns.id, input.agentRunId), eq(agentRuns.userId, input.userId)))
      .returning({ id: agentRuns.id });
    return Boolean(updatedRows[0]);
  });
}

function agentRunConfig(input: CreateAgentRunInput): AgentRunConfig {
  return {
    agentName: input.agentName,
    ...(input.budgetCapUsd === undefined ? {} : { budgetCapUsd: input.budgetCapUsd }),
    source: input.source,
  };
}

async function activeRunHandle(
  db: Database,
  input: { projectId: string; runId: string; threadId: string; userId: UserId },
): Promise<AgentRunHandle> {
  const existing = await findAgentRunForUser(db, {
    runId: toAgentRunId(input.runId),
    userId: input.userId,
  });
  return (
    existing ?? {
      projectId: toProjectId(input.projectId),
      runId: toAgentRunId(input.runId),
      status: "running",
      threadId: toThreadId(input.threadId),
    }
  );
}

function agentRunHandleFromRow(row: {
  modelId: null | string;
  projectId: string;
  projectMode: string;
  runId: string;
  status: string;
  threadId: string;
}): AgentRunHandle {
  return {
    ...(row.modelId ? { modelId: row.modelId } : {}),
    projectMode: projectModeFromDb(row.projectMode),
    projectId: toProjectId(row.projectId),
    runId: toAgentRunId(row.runId),
    status: toAgentRunStatus(row.status),
    threadId: toThreadId(row.threadId),
  };
}

function projectModeFromDb(value: string): "app-builder" | "app-builder-mobile" | "general" {
  if (value === "app-builder" || value === "app-builder-mobile") {
    return value;
  }
  return "general";
}

function normalizedCost(value: number): string {
  return Number.isFinite(value) && value > 0 ? value.toFixed(6) : "0";
}

function toAgentRunStatus(value: string): AgentRunStatus {
  if (
    value === "pending" ||
    value === "running" ||
    value === "paused" ||
    value === "completed" ||
    value === "failed" ||
    value === "canceled"
  ) {
    return value;
  }
  return "failed";
}

function isTerminalRunStatus(status: AgentRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}
