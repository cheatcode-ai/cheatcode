import type { ProjectId, ThreadId, UserId } from "@cheatcode/types";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  initialProjectSettings,
  projectSummaryFromRow,
  threadFromRow,
  threadReturningColumns,
  updatedProjectSettings,
} from "./project-mappers";
import type {
  BeginProjectDeletionResult,
  CreateProjectInput,
  ProjectSummaryRecord,
  ProjectWriteState,
  SoftDeleteThreadResult,
  ThreadRecord,
  TimestampPageCursor,
  TimestampPageRecord,
  UpdateProjectInput,
} from "./project-types";
import { type ProjectSettings, projects, type ThreadLaunchIntent, threads } from "./schema";

export async function listProjects(
  db: Database,
  input: { cursor?: TimestampPageCursor; limit: number; userId: UserId },
): Promise<TimestampPageRecord<ProjectSummaryRecord>[]> {
  const rows = await db
    .select(projectSummaryColumns())
    .from(projects)
    .where(
      and(
        eq(projects.userId, input.userId),
        isNull(projects.deletedAt),
        projectPageCondition(input.cursor),
      ),
    )
    .orderBy(desc(projects.updatedAt), desc(projects.id))
    .limit(boundedPageLimit(input.limit));
  return rows.map((row) => ({
    ...projectSummaryFromRow(row),
    pageCursorAt: row.pageCursorAt,
  }));
}

function projectSummaryColumns() {
  return {
    archiveAfter: projects.archiveAfter,
    archivedPendingAction: projects.archivedPendingAction,
    createdAt: projects.createdAt,
    id: projects.id,
    masterInstructions: projects.masterInstructions,
    mode: projects.mode,
    name: projects.name,
    overQuota: projects.overQuota,
    pageCursorAt:
      sql<string>`to_char(${projects.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
        "page_cursor_at",
      ),
    settings: projects.settings,
    updatedAt: projects.updatedAt,
    workspaceSlug: projects.workspaceSlug,
  };
}

function projectPageCondition(cursor: TimestampPageCursor | undefined) {
  return cursor
    ? sql`(${projects.updatedAt} < ${cursor.at}::timestamptz or (${projects.updatedAt} = ${cursor.at}::timestamptz and ${projects.id} < ${cursor.id}::uuid))`
    : undefined;
}

function boundedPageLimit(limit: number): number {
  return Math.max(1, Math.min(101, Math.trunc(limit)));
}

/** Serializes project/thread/run lifecycle mutations for one tenant. */
export async function lockUserProjectMutations(db: Database, userId: UserId): Promise<void> {
  const identity = `cheatcode:user-project-mutations:${userId}`;
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
}

export async function countActiveProjects(db: Database, userId: UserId): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)));
  return row?.count ?? 0;
}

export async function getProject(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<ProjectSummaryRecord | null> {
  const row = await db.query.projects.findFirst({
    columns: {
      archiveAfter: true,
      archivedPendingAction: true,
      createdAt: true,
      id: true,
      masterInstructions: true,
      mode: true,
      name: true,
      overQuota: true,
      settings: true,
      updatedAt: true,
      workspaceSlug: true,
    },
    where: and(
      eq(projects.id, input.projectId),
      eq(projects.userId, input.userId),
      isNull(projects.deletedAt),
    ),
  });
  return row ? projectSummaryFromRow(row) : null;
}

/** The absolute sandbox folder for a project's immutable workspace slug (/workspace/<slug>). */
export function workspacePathForSlug(slug: string): string {
  return `/workspace/${slug}`;
}

/** Postgres unique_violation SQLSTATE, raised by the unique index on (user_id, slug). */
const PG_UNIQUE_VIOLATION = "23505";
const WORKSPACE_SLUG_UNIQUE_INDEX = "v2_projects_user_workspace_slug_uidx";
const MAX_WORKSPACE_SLUG_ATTEMPTS = 5;

/** Lowercase, filesystem-safe kebab slug (folder name) from a project display name. */
export function filesystemSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "project";
}

/**
 * A per-user-unique workspace slug: derives a filesystem-safe base from `name`, then appends
 * -2, -3, … until it collides with none of the user's existing project slugs (including
 * soft-deleted ones, whose sandbox-disk folders may still exist). Queried in the caller's tx.
 */
async function computeUniqueWorkspaceSlug(
  db: Database,
  userId: UserId,
  name: string,
): Promise<string> {
  const base = filesystemSlug(name);
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.workspaceSlug, base)))
    .limit(1);
  if (!existing) {
    return base;
  }
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  return `${base}-${suffix}`;
}

export async function createProject(
  db: Database,
  input: CreateProjectInput,
): Promise<ProjectSummaryRecord> {
  await lockUserProjectMutations(db, input.userId);
  const settings = initialProjectSettings(input);
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_WORKSPACE_SLUG_ATTEMPTS; attempt += 1) {
    try {
      // Each attempt runs in its own savepoint so a concurrent slug collision (23505 on the
      // partial unique index) rolls back only the failed insert — not the caller's transaction —
      // and we recompute against the now-committed competing slug before retrying.
      return await db.transaction(async (tx) => {
        const scoped = tx as Database;
        const workspaceSlug = await computeUniqueWorkspaceSlug(scoped, input.userId, input.name);
        return insertProjectRow(scoped, input, settings, workspaceSlug);
      });
    } catch (error) {
      if (!isWorkspaceSlugUniqueViolation(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError ?? new Error("Failed to create project");
}

async function insertProjectRow(
  db: Database,
  input: CreateProjectInput,
  settings: ProjectSettings | null,
  workspaceSlug: string,
): Promise<ProjectSummaryRecord> {
  const rows = await db
    .insert(projects)
    .values({
      masterInstructions: input.masterInstructions,
      mode: input.mode,
      name: input.name,
      workspaceSlug,
      ...(settings ? { settings } : {}),
      userId: input.userId,
    })
    .returning({
      archiveAfter: projects.archiveAfter,
      archivedPendingAction: projects.archivedPendingAction,
      createdAt: projects.createdAt,
      id: projects.id,
      masterInstructions: projects.masterInstructions,
      mode: projects.mode,
      name: projects.name,
      overQuota: projects.overQuota,
      settings: projects.settings,
      updatedAt: projects.updatedAt,
      workspaceSlug: projects.workspaceSlug,
    });
  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create project");
  }
  return projectSummaryFromRow(row);
}

/**
 * True only for a unique-violation on the workspace-slug index (walking `.cause` since drizzle may
 * wrap the pg driver error). Constrains retries to slug races, not some other unique conflict.
 */
function isWorkspaceSlugUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (typeof current !== "object") {
      return false;
    }
    const record = current as { cause?: unknown; code?: unknown; constraint?: unknown };
    if (record.code === PG_UNIQUE_VIOLATION) {
      return record.constraint === undefined || record.constraint === WORKSPACE_SLUG_UNIQUE_INDEX;
    }
    current = record.cause;
  }
  return false;
}

export async function updateProject(
  db: Database,
  input: UpdateProjectInput,
): Promise<ProjectSummaryRecord | null> {
  const settings = await updatedProjectSettings(db, input);
  const rows = await db
    .update(projects)
    .set({
      ...(input.masterInstructions !== undefined
        ? { masterInstructions: input.masterInstructions }
        : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(settings ? { settings } : {}),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.userId, input.userId),
        isNull(projects.deletedAt),
      ),
    )
    .returning({
      archiveAfter: projects.archiveAfter,
      archivedPendingAction: projects.archivedPendingAction,
      createdAt: projects.createdAt,
      id: projects.id,
      masterInstructions: projects.masterInstructions,
      mode: projects.mode,
      name: projects.name,
      overQuota: projects.overQuota,
      settings: projects.settings,
      updatedAt: projects.updatedAt,
      workspaceSlug: projects.workspaceSlug,
    });
  const row = rows[0];
  return row ? projectSummaryFromRow(row) : null;
}

export async function beginProjectDeletion(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<BeginProjectDeletionResult> {
  await lockUserProjectMutations(db, input.userId);
  const project = await lockProjectForDeletion(db, input);
  if (!project) {
    return { type: "not-found" };
  }
  if (project.cleanupCompletedAt) {
    return { type: "cleanup-completed" };
  }
  if (await projectHasActiveRun(db, input)) {
    return { type: "active-run" };
  }
  await markProjectDeletionRequested(db, input);
  return { type: "cleanup-required", workspaceSlug: project.workspaceSlug };
}

async function lockProjectForDeletion(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
) {
  const [project] = await db
    .select({
      cleanupCompletedAt: projects.workspaceCleanupCompletedAt,
      workspaceSlug: projects.workspaceSlug,
    })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.userId, input.userId)))
    .for("update")
    .limit(1);
  return project ?? null;
}

async function projectHasActiveRun(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<boolean> {
  const [activeThread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.projectId, input.projectId),
        eq(threads.userId, input.userId),
        isNull(threads.deletedAt),
        isNotNull(threads.activeRunId),
      ),
    )
    .limit(1);
  return Boolean(activeThread);
}

async function markProjectDeletionRequested(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<void> {
  await db
    .update(projects)
    .set({
      deletedAt: sql`coalesce(${projects.deletedAt}, now())`,
      updatedAt: sql`now()`,
      workspaceCleanupRequestedAt: sql`coalesce(${projects.workspaceCleanupRequestedAt}, now())`,
    })
    .where(and(eq(projects.id, input.projectId), eq(projects.userId, input.userId)));
  await db
    .update(threads)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(threads.projectId, input.projectId),
        eq(threads.userId, input.userId),
        isNull(threads.deletedAt),
      ),
    );
}

export async function completeProjectWorkspaceCleanup(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<boolean> {
  await lockUserProjectMutations(db, input.userId);
  const rows = await db
    .update(projects)
    .set({ updatedAt: sql`now()`, workspaceCleanupCompletedAt: sql`now()` })
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.userId, input.userId),
        isNotNull(projects.deletedAt),
        isNotNull(projects.workspaceCleanupRequestedAt),
        isNull(projects.workspaceCleanupCompletedAt),
      ),
    )
    .returning({ id: projects.id });
  if (rows.length > 0) {
    return true;
  }
  const [completed] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.userId, input.userId),
        isNotNull(projects.workspaceCleanupCompletedAt),
      ),
    )
    .limit(1);
  return Boolean(completed);
}

export async function listProjectThreads(
  db: Database,
  input: {
    cursor?: TimestampPageCursor;
    limit: number;
    projectId: ProjectId;
    userId: UserId;
  },
): Promise<TimestampPageRecord<ThreadRecord>[]> {
  const rows = await db
    .select({
      ...threadReturningColumns(),
      pageCursorAt:
        sql<string>`to_char(${threads.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
          "page_cursor_at",
        ),
    })
    .from(threads)
    .where(
      and(
        eq(threads.projectId, input.projectId),
        eq(threads.userId, input.userId),
        isNull(threads.deletedAt),
        threadPageCondition(input.cursor),
      ),
    )
    .orderBy(desc(threads.updatedAt), desc(threads.id))
    .limit(boundedPageLimit(input.limit));
  return rows.map((row) => ({ ...threadFromRow(row), pageCursorAt: row.pageCursorAt }));
}

function threadPageCondition(cursor: TimestampPageCursor | undefined) {
  return cursor
    ? sql`(${threads.updatedAt} < ${cursor.at}::timestamptz or (${threads.updatedAt} = ${cursor.at}::timestamptz and ${threads.id} < ${cursor.id}::uuid))`
    : undefined;
}

export async function createThread(
  db: Database,
  input: {
    launchIntent?: ThreadLaunchIntent;
    projectId?: ProjectId | null;
    title?: string;
    userId: UserId;
  },
): Promise<ThreadRecord> {
  await lockUserProjectMutations(db, input.userId);
  const rows = await db
    .insert(threads)
    .values({
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.launchIntent ? { launchIntent: input.launchIntent } : {}),
      ...(input.title ? { title: input.title } : {}),
      userId: input.userId,
    })
    .returning(threadReturningColumns());
  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create thread");
  }
  return threadFromRow(row);
}

export async function updateThread(
  db: Database,
  input: { threadId: ThreadId; title: string; userId: UserId },
): Promise<ThreadRecord | null> {
  const rows = await db
    .update(threads)
    .set({ title: input.title, updatedAt: sql`now()` })
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.userId, input.userId),
        isNull(threads.deletedAt),
      ),
    )
    .returning(threadReturningColumns());
  const row = rows[0];
  return row ? threadFromRow(row) : null;
}

export async function softDeleteThread(
  db: Database,
  input: { threadId: ThreadId; userId: UserId },
): Promise<SoftDeleteThreadResult> {
  await lockUserProjectMutations(db, input.userId);
  const [thread] = await db
    .select({ activeRunId: threads.activeRunId })
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
  if (!thread) {
    return "not-found";
  }
  if (thread.activeRunId) {
    return "active-run";
  }
  const rows = await db
    .update(threads)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.userId, input.userId),
        isNull(threads.deletedAt),
      ),
    )
    .returning({ id: threads.id });
  return rows.length > 0 ? "deleted" : "not-found";
}

export async function getThread(
  db: Database,
  input: { threadId: ThreadId; userId: UserId },
): Promise<ThreadRecord | null> {
  const row = await db.query.threads.findFirst({
    columns: {
      activeRunId: true,
      createdAt: true,
      id: true,
      launchIntent: true,
      projectId: true,
      title: true,
      updatedAt: true,
    },
    where: and(
      eq(threads.id, input.threadId),
      eq(threads.userId, input.userId),
      isNull(threads.deletedAt),
    ),
  });
  return row ? threadFromRow(row) : null;
}

export async function getProjectWriteState(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<ProjectWriteState | null> {
  const row = await db.query.projects.findFirst({
    columns: {
      archiveAfter: true,
      archivedPendingAction: true,
      overQuota: true,
    },
    where: and(
      eq(projects.id, input.projectId),
      eq(projects.userId, input.userId),
      isNull(projects.deletedAt),
    ),
  });
  return row
    ? {
        archiveAfter: row.archiveAfter,
        archivedPendingAction: row.archivedPendingAction,
        overQuota: row.overQuota,
        readOnly: row.archivedPendingAction || row.overQuota,
      }
    : null;
}
