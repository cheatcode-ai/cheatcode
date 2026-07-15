import type { ProjectId, ThreadId, UserId } from "@cheatcode/types";
import { ProjectId as toProjectId, ThreadId as toThreadId } from "@cheatcode/types";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import { projects, threads } from "./schema";

export interface WorkspaceSearchInput {
  q: string;
  limit: number;
}

export interface WorkspaceProjectSearchRecord {
  type: "project";
  id: ProjectId;
  name: string;
  latestThreadId: ThreadId | null;
  updatedAt: Date;
}

export interface WorkspaceThreadSearchRecord {
  type: "thread";
  id: ThreadId;
  title: string;
  /** Null for a project-less chat (chat-first: no project until its first run). */
  projectId: ProjectId | null;
  projectName: string | null;
  updatedAt: Date;
  /** Non-null while a run is in flight — backs the sidebar's running-chat spinner. */
  activeRunId: string | null;
}

export type WorkspaceSearchRecord = WorkspaceProjectSearchRecord | WorkspaceThreadSearchRecord;

/**
 * Escapes the LIKE/ILIKE wildcard metacharacters so a user query is matched
 * literally. Backslash is escaped first to avoid double-escaping the others.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Searches a user's projects (by name) and threads (by title) with two escaped
 * ILIKE queries, projects first then threads, each ordered newest-first. Reads
 * only `name`/`title`; message text is intentionally out of scope.
 */
export async function searchWorkspace(
  db: Database,
  userId: UserId,
  input: WorkspaceSearchInput,
): Promise<WorkspaceSearchRecord[]> {
  const pattern = `%${escapeLikePattern(input.q)}%`;
  const projectResults = await searchProjectRecords(db, userId, pattern, input.limit);
  const threadResults = await searchThreadRecords(db, userId, pattern, input.limit);
  return [...projectResults, ...threadResults];
}

async function searchProjectRecords(
  db: Database,
  userId: UserId,
  pattern: string,
  limit: number,
): Promise<WorkspaceProjectSearchRecord[]> {
  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      updatedAt: projects.updatedAt,
      latestThreadId: sql<string | null>`(
        select sub.id
        from ${threads} as sub
        where sub.project_id = ${projects.id} and sub.deleted_at is null
        order by sub.updated_at desc
        limit 1
      )`,
    })
    .from(projects)
    .where(
      and(
        eq(projects.userId, userId),
        isNull(projects.deletedAt),
        sql`${projects.name} ilike ${pattern} escape '\\'`,
      ),
    )
    .orderBy(desc(projects.updatedAt))
    .limit(limit);
  return projectRows.map((row) => ({
    type: "project",
    id: toProjectId(row.id),
    name: row.name,
    latestThreadId: row.latestThreadId ? toThreadId(row.latestThreadId) : null,
    updatedAt: row.updatedAt,
  }));
}

async function searchThreadRecords(
  db: Database,
  userId: UserId,
  pattern: string,
  limit: number,
): Promise<WorkspaceThreadSearchRecord[]> {
  const threadRows = await db
    .select({
      id: threads.id,
      title: threads.title,
      updatedAt: threads.updatedAt,
      projectId: projects.id,
      projectName: projects.name,
      activeRunId: threads.activeRunId,
    })
    .from(threads)
    .leftJoin(projects, eq(projects.id, threads.projectId))
    .where(
      and(
        eq(threads.userId, userId),
        isNull(threads.deletedAt),
        // Include project-less chats; exclude chats whose project was soft-deleted.
        or(isNull(threads.projectId), isNull(projects.deletedAt)),
        sql`${threads.title} ilike ${pattern} escape '\\'`,
      ),
    )
    .orderBy(desc(threads.updatedAt))
    .limit(limit);
  return threadRows.map((row) => ({
    type: "thread",
    id: toThreadId(row.id),
    title: row.title ?? "",
    projectId: row.projectId ? toProjectId(row.projectId) : null,
    projectName: row.projectName,
    updatedAt: row.updatedAt,
    activeRunId: row.activeRunId,
  }));
}

/**
 * A user's most-recently-active threads (chats) across all their projects, newest first.
 * Backs the chat-first sidebar's "Chats" list. Mirrors the thread half of
 * `searchWorkspace` minus the title filter; filters by BOTH `threads.userId` and
 * `projects.userId` (defense-in-depth — these tables have no broad RLS). Served by the
 * partial index `threads (user_id, updated_at desc) where deleted_at is null`.
 */
export async function listRecentThreads(
  db: Database,
  userId: UserId,
  limit: number,
): Promise<WorkspaceThreadSearchRecord[]> {
  const rows = await db
    .select({
      id: threads.id,
      title: threads.title,
      updatedAt: threads.updatedAt,
      projectId: projects.id,
      projectName: projects.name,
      activeRunId: threads.activeRunId,
    })
    .from(threads)
    .leftJoin(projects, and(eq(projects.id, threads.projectId), eq(projects.userId, userId)))
    .where(
      and(
        eq(threads.userId, userId),
        isNull(threads.deletedAt),
        // Include project-less chats; exclude chats whose project was soft-deleted.
        or(isNull(threads.projectId), isNull(projects.deletedAt)),
      ),
    )
    .orderBy(desc(threads.updatedAt))
    .limit(limit);

  return rows.map((row) => ({
    type: "thread",
    id: toThreadId(row.id),
    title: row.title ?? "",
    projectId: row.projectId ? toProjectId(row.projectId) : null,
    projectName: row.projectName,
    updatedAt: row.updatedAt,
    activeRunId: row.activeRunId,
  }));
}
