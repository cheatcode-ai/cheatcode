import { ProjectId, type ThreadId, type UserId } from "@cheatcode/types";
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
  BeginThreadDeletionResult,
  CreateProjectInput,
  ProjectSummaryRecord,
  ProjectWriteState,
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
    createdAt: projects.createdAt,
    id: projects.id,
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
      createdAt: true,
      id: true,
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

export function canonicalWorkspaceSlugForProject(name: string, projectId: ProjectId): string {
  const base = filesystemSlug(name).slice(0, 27).replace(/-+$/g, "") || "project";
  return `${base}-${projectId}`;
}

export async function createProject(
  db: Database,
  input: CreateProjectInput,
): Promise<ProjectSummaryRecord> {
  await lockUserProjectMutations(db, input.userId);
  const settings = initialProjectSettings(input);
  const projectId = ProjectId(crypto.randomUUID());
  return insertProjectRow(
    db,
    input,
    settings,
    projectId,
    canonicalWorkspaceSlugForProject(input.name, projectId),
  );
}

async function insertProjectRow(
  db: Database,
  input: CreateProjectInput,
  settings: ProjectSettings | null,
  projectId: ProjectId,
  workspaceSlug: string,
): Promise<ProjectSummaryRecord> {
  const rows = await db
    .insert(projects)
    .values({
      id: projectId,
      mode: input.mode,
      name: input.name,
      workspaceSlug,
      ...(settings ? { settings } : {}),
      userId: input.userId,
    })
    .returning({
      archiveAfter: projects.archiveAfter,
      createdAt: projects.createdAt,
      id: projects.id,
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

export async function updateProject(
  db: Database,
  input: UpdateProjectInput,
): Promise<ProjectSummaryRecord | null> {
  const settings = await updatedProjectSettings(db, input);
  const rows = await db
    .update(projects)
    .set({
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
      createdAt: projects.createdAt,
      id: projects.id,
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
  if (project.deletedAt) {
    return {
      deletedAt: project.deletedAt,
      type: "cleanup-required",
      workspaceSlug: project.workspaceSlug,
    };
  }
  if (await projectHasActiveRun(db, input)) {
    return { type: "active-run" };
  }
  const deletedAt = await markProjectDeletionRequested(db, input);
  return { deletedAt, type: "cleanup-required", workspaceSlug: project.workspaceSlug };
}

async function lockProjectForDeletion(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
) {
  const [project] = await db
    .select({
      deletedAt: projects.deletedAt,
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
        isNotNull(threads.activeRunId),
      ),
    )
    .limit(1);
  return Boolean(activeThread);
}

async function markProjectDeletionRequested(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<Date> {
  const [project] = await db
    .update(projects)
    .set({
      deletedAt: sql`coalesce(${projects.deletedAt}, date_trunc('milliseconds', now()))`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(projects.id, input.projectId), eq(projects.userId, input.userId)))
    .returning({ deletedAt: projects.deletedAt });
  if (!project?.deletedAt) {
    throw new Error("Project deletion tombstone was not persisted");
  }
  await db
    .update(threads)
    .set({
      deletedAt: sql`coalesce(${threads.deletedAt}, ${project.deletedAt})`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(threads.projectId, input.projectId), eq(threads.userId, input.userId)));
  return project.deletedAt;
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

export async function beginThreadDeletion(
  db: Database,
  input: { threadId: ThreadId; userId: UserId },
): Promise<BeginThreadDeletionResult> {
  await lockUserProjectMutations(db, input.userId);
  const [thread] = await db
    .select({
      activeRunId: threads.activeRunId,
      deletedAt: threads.deletedAt,
      projectId: threads.projectId,
    })
    .from(threads)
    .where(and(eq(threads.id, input.threadId), eq(threads.userId, input.userId)))
    .for("update")
    .limit(1);
  if (!thread) {
    return { type: "not-found" };
  }
  if (thread.deletedAt) {
    return {
      deletedAt: thread.deletedAt,
      projectId: thread.projectId ? ProjectId(thread.projectId) : null,
      type: "cleanup-required",
    };
  }
  if (thread.activeRunId) {
    return { type: "active-run" };
  }
  const [deleted] = await db
    .update(threads)
    .set({
      deletedAt: sql`coalesce(${threads.deletedAt}, date_trunc('milliseconds', now()))`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(threads.id, input.threadId), eq(threads.userId, input.userId)))
    .returning({ deletedAt: threads.deletedAt });
  if (!deleted?.deletedAt) {
    throw new Error("Thread deletion tombstone was not persisted");
  }
  return {
    deletedAt: deleted.deletedAt,
    projectId: thread.projectId ? ProjectId(thread.projectId) : null,
    type: "cleanup-required",
  };
}

export async function getThread(
  db: Database,
  input: { threadId: ThreadId; userId: UserId },
): Promise<ThreadRecord | null> {
  const [row] = await db
    .select(threadReturningColumns())
    .from(threads)
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.userId, input.userId),
        isNull(threads.deletedAt),
      ),
    )
    .limit(1);
  return row ? threadFromRow(row) : null;
}

export async function getProjectWriteState(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<ProjectWriteState | null> {
  const row = await db.query.projects.findFirst({
    columns: {
      archiveAfter: true,
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
        overQuota: row.overQuota,
        readOnly: row.overQuota,
      }
    : null;
}
