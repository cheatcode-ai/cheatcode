import type { ProjectId, ThreadId, UserId } from "@cheatcode/types";
import { toProjectId, toThreadId } from "@cheatcode/types";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { projectSummaryFromRow } from "./project-mappers";
import type { ProjectRecord } from "./project-types";
import { projects, threads } from "./schema";
import { listRecentThreads, type WorkspaceThreadSearchRecord } from "./search";

export interface NavigationProjectRecord extends ProjectRecord {
  latestThreadId: ThreadId | null;
}

interface NavigationBootstrapRecord {
  activeProjectId: ProjectId | null;
  projects: NavigationProjectRecord[];
  recentThreads: WorkspaceThreadSearchRecord[];
}

/** Loads the complete bounded sidebar snapshot in two queries inside one RLS transaction. */
export async function loadNavigationBootstrap(
  db: Database,
  input: { activeThreadId?: ThreadId; userId: UserId },
): Promise<NavigationBootstrapRecord> {
  const recentThreads = await listRecentThreads(db, input.userId, 20);
  const projectRows = await listNavigationProjects(db, input);
  const activeProjectId = projectRows[0]?.activeProjectId ?? null;
  return {
    activeProjectId: activeProjectId ? toProjectId(activeProjectId) : null,
    projects: projectRows.map(navigationProjectFromRow),
    recentThreads,
  };
}

function listNavigationProjects(
  db: Database,
  input: { activeThreadId?: ThreadId; userId: UserId },
) {
  const activeProjectId = activeProjectIdExpression(input);
  const latestThread = db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.projectId, projects.id),
        eq(threads.userId, input.userId),
        isNull(threads.deletedAt),
      ),
    )
    .orderBy(desc(threads.updatedAt), desc(threads.id))
    .limit(1)
    .as("latest_thread");
  return db
    .select({
      activeProjectId,
      archiveAfter: projects.archiveAfter,
      createdAt: projects.createdAt,
      id: projects.id,
      latestThreadId: latestThread.id,
      mode: projects.mode,
      name: projects.name,
      overQuota: projects.overQuota,
      settings: projects.settings,
      updatedAt: projects.updatedAt,
      workspaceSlug: projects.workspaceSlug,
    })
    .from(projects)
    .leftJoinLateral(latestThread, sql`true`)
    .where(and(eq(projects.userId, input.userId), isNull(projects.deletedAt)))
    .orderBy(
      sql`case when ${projects.id} = ${activeProjectId} then 0 else 1 end`,
      desc(projects.updatedAt),
      desc(projects.id),
    )
    .limit(6);
}

function activeProjectIdExpression(input: { activeThreadId?: ThreadId; userId: UserId }) {
  if (!input.activeThreadId) return sql<string | null>`null::uuid`;
  return sql<string | null>`(
    select active_thread.project_id
      from ${threads} active_thread
      join ${projects} active_project
        on active_project.id = active_thread.project_id
       and active_project.user_id = ${input.userId}
       and active_project.deleted_at is null
     where active_thread.id = ${input.activeThreadId}
       and active_thread.user_id = ${input.userId}
       and active_thread.deleted_at is null
     limit 1
  )`;
}

function navigationProjectFromRow(
  row: Awaited<ReturnType<typeof listNavigationProjects>>[number],
): NavigationProjectRecord {
  return {
    ...projectSummaryFromRow(row),
    latestThreadId: row.latestThreadId ? toThreadId(row.latestThreadId) : null,
  };
}
