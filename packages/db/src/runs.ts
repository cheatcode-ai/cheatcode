import type { AgentRunId, ProjectId, ThreadId, UserId } from "@cheatcode/types";
import {
  AGENT_MODEL_CATALOG,
  PRODUCTION_DEFAULT_MODEL_ID,
  AgentRunId as toAgentRunId,
  ProjectId as toProjectId,
  ThreadId as toThreadId,
} from "@cheatcode/types";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import type { RunPersonalization } from "./profiles";
import { attachProjectSandboxWithLimit, countActiveProjects, createProject } from "./projects";
import {
  type AgentRunConfig,
  type AgentRunError,
  agentRuns,
  entitlements,
  type ProjectSettings,
  projects,
  type ThreadLaunchIntent,
  threads,
  usageEvents,
} from "./schema";

export type AgentRunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "canceled";

const DEFAULT_RUN_BUDGET_CAP_USD = 5;

/**
 * Total wall-clock minutes the agent "worked" for this user since the start of
 * today in `timezone` (a CF-edge IANA zone; pass "UTC" as a safe default). Sums
 * finished runs' (finishedAt − startedAt). Powers bud's "cheatcode worked Nm
 * today" home headline.
 */
export async function sumWorkedMinutesToday(
  db: Database,
  userId: UserId,
  timezone: string,
): Promise<number> {
  const rows = await db
    .select({
      seconds: sql<string>`coalesce(sum(extract(epoch from (${agentRuns.finishedAt} - ${agentRuns.startedAt}))), 0)`,
    })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.userId, userId),
        isNotNull(agentRuns.finishedAt),
        sql`${agentRuns.finishedAt} >= date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone}`,
      ),
    );
  const seconds = Number(rows[0]?.seconds ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60) : 0;
}

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
  /** Immutable /workspace subfolder name for the project (per-user sandbox model). Every run has
   * a project (ensureProjectForRun creates it before the run), so this is always set. */
  workspaceSlug: string;
}

export interface CreateAgentRunInput {
  agentName: string;
  budgetCapUsd?: number;
  /** Active-project quota ceiling, enforced when this run lazily creates the chat's project. */
  maxActiveProjects: number;
  maxConcurrentSandboxes?: number;
  modelId?: string;
  personalization?: RunPersonalization;
  /** Resolves the sandbox DO name from the (possibly just-created) project id. */
  resolveSandboxName: (projectId: string) => Promise<string>;
  source: "web" | "api";
  threadId: ThreadId;
  userId: UserId;
}

export type CreateAgentRunResult =
  | { run: AgentRunHandle; type: "created" }
  | { type: "thread-not-found" }
  | { archiveAfter: Date | null; type: "project-read-only" }
  | { limit: number; type: "project-limit-reached"; used: number }
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
  /** When set (platform_free DeepSeek runs), meter these tokens against the lifetime allowance. */
  freeDeepseekTokens?: number;
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
  workspaceSlug: string;
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
    const ensured = await ensureProjectForRun(tx as Database, input);
    if (ensured) {
      return ensured;
    }
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

    const budgetCapUsd = resolveRunBudgetCap(input.budgetCapUsd, thread.projectSettings);
    const modelId = resolveRunModelId(input.modelId, thread.projectSettings, input.personalization);
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

/**
 * Chat-first lazy project materialization. Locks the thread row; if it has no
 * project yet (a project-less chat reaching its first run), enforces the active-
 * project quota and creates the project from the chat's launch intent, named from
 * the chat title. Runs inside the run-creation transaction so a later sandbox or
 * active-run block rolls the new project back. Returns a terminal result on
 * failure, or null once a project exists.
 */
async function ensureProjectForRun(
  db: Database,
  input: CreateAgentRunInput,
): Promise<CreateAgentRunResult | null> {
  const [locked] = await db
    .select({
      launchIntent: threads.launchIntent,
      projectId: threads.projectId,
      title: threads.title,
    })
    .from(threads)
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.userId, input.userId),
        isNull(threads.deletedAt),
      ),
    )
    .for("update")
    .limit(1);
  if (!locked) {
    return { type: "thread-not-found" };
  }
  if (locked.projectId) {
    return null;
  }
  const used = await countActiveProjects(db, input.userId);
  if (used >= input.maxActiveProjects) {
    return { limit: input.maxActiveProjects, type: "project-limit-reached", used };
  }
  const intent: ThreadLaunchIntent = locked.launchIntent ?? {};
  const project = await createProject(db, {
    mode: intent.mode ?? "general",
    name: projectNameFromTitle(locked.title),
    userId: input.userId,
    ...(intent.defaultModel ? { defaultModel: intent.defaultModel } : {}),
    ...(intent.importRepoUrl ? { importRepoUrl: intent.importRepoUrl } : {}),
  });
  await db
    .update(threads)
    .set({ projectId: project.id, updatedAt: sql`now()` })
    .where(and(eq(threads.id, input.threadId), isNull(threads.projectId)));
  return null;
}

/** Concise kebab project name from the chat's first prompt (bud's `simple-todo-app`). */
function projectNameFromTitle(title: string | null): string {
  const stripped = (title ?? "")
    .toLowerCase()
    .replace(
      /^(please\s+|can you\s+|could you\s+|build( me)?\s+|create\s+|make\s+|a\s+|an\s+|the\s+)+/g,
      "",
    );
  const slug = stripped
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 5)
    .join("-");
  return slug || "new-project";
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
        workspaceSlug: thread.workspaceSlug,
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
  if (input.maxConcurrentSandboxes === undefined) {
    return null;
  }
  const result = await attachProjectSandboxWithLimit(db, {
    maxConcurrentSandboxes: input.maxConcurrentSandboxes,
    projectId: toProjectId(thread.projectId),
    sandboxId: await input.resolveSandboxName(thread.projectId),
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
    workspaceSlug: assertWorkspaceSlug(thread.workspaceSlug, thread.id),
  };
}

/**
 * Post-migration invariant: every run has a project, so its workspace slug is always set (the DB
 * column is NOT NULL and every join here is an inner join). This asserts that at the boundary
 * rather than silently defaulting to a shared folder, surfacing any data corruption loudly.
 */
function assertWorkspaceSlug(slug: string | null | undefined, threadId: string): string {
  if (!slug) {
    throw new Error(`Thread ${threadId} run is missing a workspace slug`);
  }
  return slug;
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
      // Non-null via the innerJoin (and ensureProjectForRun guarantees a project by now).
      projectId: projects.id,
      projectMode: projects.mode,
      projectSettings: projects.settings,
      workspaceSlug: projects.workspaceSlug,
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

export function resolveRunBudgetCap(
  inputBudgetCapUsd: number | undefined,
  projectSettings: ProjectSettings,
): number {
  return inputBudgetCapUsd ?? projectSettings.budgetCapUsd ?? DEFAULT_RUN_BUDGET_CAP_USD;
}

export function resolveRunModelId(
  inputModelId: string | undefined,
  projectSettings: ProjectSettings,
  personalization?: RunPersonalization,
): string | undefined {
  const explicit = cleanModelId(inputModelId);
  if (explicit) {
    // An explicitly-disabled model is rejected pre-resolution (400); pass the pick through unchanged.
    return explicit;
  }
  const disabled = new Set(personalization?.disabledModels ?? []);
  for (const candidate of [cleanModelId(projectSettings.defaultModel)]) {
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
      projectId: projects.id,
      projectMode: projects.mode,
      runId: agentRuns.id,
      status: agentRuns.status,
      threadId: threads.id,
      workspaceSlug: projects.workspaceSlug,
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
      projectId: projects.id,
      projectMode: projects.mode,
      runId: agentRuns.id,
      status: agentRuns.status,
      threadId: agentRuns.threadId,
      workspaceSlug: projects.workspaceSlug,
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

    // Meter platform-credited DeepSeek tokens against the per-user lifetime allowance.
    // Atomic row-locked `+=` keyed by user, in the SAME tx as the run-total update, so the
    // counter tracks agent_runs.tokens_* exactly (per-step delta, counted once) — plan WS3.
    if (input.freeDeepseekTokens && input.freeDeepseekTokens > 0) {
      await tx
        .update(entitlements)
        .set({
          freeDeepseekTokensUsed: sql`${entitlements.freeDeepseekTokensUsed} + ${input.freeDeepseekTokens}`,
        })
        .where(eq(entitlements.userId, input.userId));
    }
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
  input: {
    projectId: string;
    runId: string;
    threadId: string;
    userId: UserId;
    workspaceSlug: string;
  },
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
      workspaceSlug: input.workspaceSlug,
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
  workspaceSlug: string;
}): AgentRunHandle {
  return {
    ...(row.modelId ? { modelId: row.modelId } : {}),
    projectMode: projectModeFromDb(row.projectMode),
    projectId: toProjectId(row.projectId),
    runId: toAgentRunId(row.runId),
    status: toAgentRunStatus(row.status),
    threadId: toThreadId(row.threadId),
    workspaceSlug: assertWorkspaceSlug(row.workspaceSlug, row.threadId),
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
