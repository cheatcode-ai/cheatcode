import type {
  AgentRunId,
  LogicalModelId,
  ProjectId,
  ProjectMode,
  ThreadId,
  UserId,
} from "@cheatcode/types";
import {
  AGENT_MODEL_CATALOG,
  LogicalModelIdSchema,
  PRODUCTION_DEFAULT_MODEL_ID,
  ProjectModeSchema,
  AgentRunId as toAgentRunId,
  ProjectId as toProjectId,
  ThreadId as toThreadId,
} from "@cheatcode/types";
import { and, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { findEntitlementByUserId, lockUserEntitlementMutations } from "./billing";
import type { Database } from "./client";
import type { RunPersonalization } from "./profiles";
import { countActiveProjects, createProject, lockUserProjectMutations } from "./projects";
import {
  type AgentRunError,
  agentRuns,
  type ProjectSettings,
  projects,
  type ThreadLaunchIntent,
  threads,
} from "./schema";

const FREE_ACTIVE_PROJECT_LIMIT = 3;

export type AgentRunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "canceled";

/**
 * Total wall-clock minutes the agent "worked" for this user since the start of
 * today in `timezone` (a CF-edge IANA zone; pass "UTC" as a safe default). Sums
 * finished runs' (finishedAt − startedAt). Powers Cheatcode's "cheatcode worked Nm
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
  importRepoUrl?: string;
  isFirstRun?: boolean;
  masterInstructions?: string;
  modelId: LogicalModelId;
  projectMode?: ProjectMode;
  projectId: ProjectId;
  runId: AgentRunId;
  status: AgentRunStatus;
  threadId: ThreadId;
  /** Immutable /workspace subfolder name for the project (per-user sandbox model). Every run has
   * a project (ensureProjectForRun creates it before the run), so this is always set. */
  workspaceSlug: string;
}

export interface CreateAgentRunInput {
  idempotencyKeyHash: string;
  modelId?: LogicalModelId;
  personalization?: RunPersonalization;
  requestBodyHash: string;
  threadId: ThreadId;
  userId: UserId;
}

export type CreateAgentRunResult =
  | { modelExplicit: boolean; run: AgentRunHandle; type: "created" }
  | { run: AgentRunHandle; type: "idempotent-replay" }
  | { type: "idempotency-key-reused" }
  | { type: "thread-not-found" }
  | { archiveAfter: Date | null; type: "project-read-only" }
  | { limit: number; type: "project-limit-reached"; used: number }
  | { run: AgentRunHandle; type: "active-run-exists" };

export interface UpdateAgentRunStatusInput {
  error?: AgentRunError;
  runId: AgentRunId;
  status: AgentRunStatus;
  userId: UserId;
}

export interface UpdateAgentRunLogicalModelInput {
  logicalModelId: LogicalModelId;
  runId: AgentRunId;
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
  projectMode: ProjectMode;
  projectSettings: ProjectSettings;
  workspaceSlug: string;
}

interface CreatedRunRow {
  id: string;
  status: string;
}

interface RunModelPlan {
  logicalModelId: LogicalModelId;
  modelExplicit: boolean;
}

export async function createAgentRunForThread(
  db: Database,
  input: CreateAgentRunInput,
): Promise<CreateAgentRunResult> {
  return db.transaction((tx) => createAgentRunTransaction(tx as Database, input));
}

async function createAgentRunTransaction(
  db: Database,
  input: CreateAgentRunInput,
): Promise<CreateAgentRunResult> {
  await lockRunIdempotencyKey(db, input);
  const replay = await idempotentRunCreationResult(db, input);
  if (replay) {
    return replay;
  }
  // Billing reconciliation takes the same entitlement -> project lock order. Read the ceiling
  // under those locks so a concurrent upgrade/downgrade cannot race lazy project creation.
  await lockUserEntitlementMutations(db, input.userId);
  await lockUserProjectMutations(db, input.userId);
  const entitlement = await findEntitlementByUserId(db, input.userId);
  const ensured = await ensureProjectForRun(
    db,
    input,
    entitlement?.maxProjects ?? FREE_ACTIVE_PROJECT_LIMIT,
  );
  if (ensured) {
    return ensured;
  }
  const thread = await findThreadForRun(db, input);
  if (!thread) {
    return { type: "thread-not-found" };
  }
  const blockedResult = await blockedRunCreationResult(db, input, thread);
  if (blockedResult) {
    return blockedResult;
  }
  return createAndActivateRun(db, input, thread);
}

async function createAndActivateRun(
  db: Database,
  input: CreateAgentRunInput,
  thread: ThreadForRunRow,
): Promise<CreateAgentRunResult> {
  const modelPlan = resolveRunModelPlan(
    input.modelId,
    thread.projectSettings,
    input.personalization,
  );
  const isFirstRun = await isFirstAgentRunForUser(db, input.userId);
  const created = await insertPendingRun(db, input, modelPlan.logicalModelId);
  if (await activateCreatedRun(db, input, created.id)) {
    return {
      modelExplicit: modelPlan.modelExplicit,
      run: createdRunHandle(thread, modelPlan.logicalModelId, created, isFirstRun),
      type: "created",
    };
  }
  await cancelSupersededRun(db, created.id);
  const active = await findActiveAgentRunForThread(db, {
    threadId: input.threadId,
    userId: input.userId,
  });
  if (!active) {
    throw new Error("Thread active run changed but could not be resolved");
  }
  return { run: active, type: "active-run-exists" };
}

async function lockRunIdempotencyKey(db: Database, input: CreateAgentRunInput): Promise<void> {
  const identity = `cheatcode:run-idempotency:${input.userId}:${input.idempotencyKeyHash}`;
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
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
  maxActiveProjects: number,
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
  if (used >= maxActiveProjects) {
    return { limit: maxActiveProjects, type: "project-limit-reached", used };
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
    // Launch intent is single-use input for lazy project materialization. Keeping a
    // project-bound copy creates two sources of truth for mode and settings.
    .set({ launchIntent: null, projectId: project.id, updatedAt: sql`now()` })
    .where(and(eq(threads.id, input.threadId), isNull(threads.projectId)));
  return null;
}

/** Concise kebab project name from the chat's first prompt (Cheatcode's `simple-todo-app`). */
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
        runId: thread.activeRunId,
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

function createdRunHandle(
  thread: ThreadForRunRow,
  modelId: LogicalModelId,
  created: CreatedRunRow,
  isFirstRun: boolean,
): AgentRunHandle {
  return {
    projectId: toProjectId(thread.projectId),
    ...(thread.projectSettings.importRepoUrl
      ? { importRepoUrl: thread.projectSettings.importRepoUrl }
      : {}),
    ...(isFirstRun ? { isFirstRun } : {}),
    ...(thread.masterInstructions ? { masterInstructions: thread.masterInstructions } : {}),
    modelId,
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
  modelId: LogicalModelId,
): Promise<CreatedRunRow> {
  const rows = await db
    .insert(agentRuns)
    .values({
      idempotencyKeyHash: input.idempotencyKeyHash,
      modelId,
      requestBodyHash: input.requestBodyHash,
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

async function idempotentRunCreationResult(
  db: Database,
  input: CreateAgentRunInput,
): Promise<CreateAgentRunResult | null> {
  const [existing] = await db
    .select({
      requestBodyHash: agentRuns.requestBodyHash,
      runId: agentRuns.id,
      threadId: agentRuns.threadId,
    })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.userId, input.userId),
        eq(agentRuns.idempotencyKeyHash, input.idempotencyKeyHash),
      ),
    )
    .limit(1);
  if (!existing) {
    return null;
  }
  if (existing.threadId !== input.threadId || existing.requestBodyHash !== input.requestBodyHash) {
    return { type: "idempotency-key-reused" };
  }
  const run = await findAgentRunForUser(db, {
    runId: toAgentRunId(existing.runId),
    userId: input.userId,
  });
  if (!run) {
    throw new Error("Idempotent run exists without a readable run handle");
  }
  return { run, type: "idempotent-replay" };
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

function resolveRunModelPlan(
  inputModelId: LogicalModelId | undefined,
  projectSettings: ProjectSettings,
  personalization?: RunPersonalization,
): RunModelPlan {
  const explicit = parseLogicalModelId(inputModelId);
  if (explicit) {
    // An explicitly-disabled model is rejected pre-resolution (400); pass the pick through unchanged.
    return { logicalModelId: explicit, modelExplicit: true };
  }
  const disabled = new Set(personalization?.disabledModels ?? []);
  for (const candidate of [parseLogicalModelId(projectSettings.defaultModel)]) {
    if (candidate && !disabled.has(candidate)) {
      return { logicalModelId: candidate, modelExplicit: true };
    }
  }
  // "Auto" is a concrete plan; the execution layer may later attribute a logical fallback.
  if (!disabled.has(PRODUCTION_DEFAULT_MODEL_ID)) {
    return { logicalModelId: PRODUCTION_DEFAULT_MODEL_ID, modelExplicit: false };
  }
  const fallback = AGENT_MODEL_CATALOG.find((entry) => !disabled.has(entry.id));
  if (!fallback) {
    throw new Error("At least one agent model must remain enabled");
  }
  return { logicalModelId: fallback.id, modelExplicit: false };
}

function parseLogicalModelId(value: string | null | undefined): LogicalModelId | undefined {
  const parsed = LogicalModelIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
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
      .where(
        and(
          eq(agentRuns.id, input.runId),
          eq(agentRuns.userId, input.userId),
          notInArray(agentRuns.status, ["completed", "failed", "canceled"]),
        ),
      )
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

/** Persists the product-level model identity selected for the next stream attempt. */
export async function updateAgentRunLogicalModelId(
  db: Database,
  input: UpdateAgentRunLogicalModelInput,
): Promise<boolean> {
  const rows = await db
    .update(agentRuns)
    .set({ modelId: input.logicalModelId })
    .where(
      and(
        eq(agentRuns.id, input.runId),
        eq(agentRuns.userId, input.userId),
        notInArray(agentRuns.status, ["completed", "failed", "canceled"]),
      ),
    )
    .returning({ id: agentRuns.id });
  return Boolean(rows[0]);
}

/**
 * Compensates a committed run row only after its run-keyed Durable Object has
 * authoritatively reported no state. The run row and matching thread pointer
 * move together so a failed admission cannot strand the thread.
 */
export async function reconcileAbsentAgentRunStart(
  db: Database,
  input: { runId: AgentRunId; userId: UserId },
): Promise<"failed" | "not-found" | "terminal"> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({ status: agentRuns.status, threadId: agentRuns.threadId })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, input.runId), eq(agentRuns.userId, input.userId)))
      .for("update")
      .limit(1);
    if (!run) {
      return "not-found";
    }
    const status = toAgentRunStatus(run.status);
    if (!isTerminalRunStatus(status)) {
      await tx
        .update(agentRuns)
        .set({
          error: {
            message: "The run service did not admit this run.",
            type: "run_start_absent",
          },
          finishedAt: sql`now()`,
          status: "failed",
        })
        .where(and(eq(agentRuns.id, input.runId), eq(agentRuns.userId, input.userId)));
    }
    await tx
      .update(threads)
      .set({ activeRunId: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(threads.id, run.threadId),
          eq(threads.userId, input.userId),
          eq(threads.activeRunId, input.runId),
        ),
      );
    return isTerminalRunStatus(status) ? "terminal" : "failed";
  });
}

async function activeRunHandle(
  db: Database,
  input: {
    runId: string;
    userId: UserId;
  },
): Promise<AgentRunHandle> {
  const existing = await findAgentRunForUser(db, {
    runId: toAgentRunId(input.runId),
    userId: input.userId,
  });
  if (!existing) {
    throw new Error(`Active agent run ${input.runId} is missing its database row`);
  }
  return existing;
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
    modelId: parseLogicalModelId(row.modelId) ?? PRODUCTION_DEFAULT_MODEL_ID,
    projectMode: projectModeFromDb(row.projectMode),
    projectId: toProjectId(row.projectId),
    runId: toAgentRunId(row.runId),
    status: toAgentRunStatus(row.status),
    threadId: toThreadId(row.threadId),
    workspaceSlug: assertWorkspaceSlug(row.workspaceSlug, row.threadId),
  };
}

function projectModeFromDb(value: string): ProjectMode {
  return ProjectModeSchema.parse(value);
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
