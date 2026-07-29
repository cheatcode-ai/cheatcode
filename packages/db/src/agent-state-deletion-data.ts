import type { ProjectId, ThreadId, UserId } from "@cheatcode/types";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "./client";
import { agentRuns, projects, threads, users } from "./schema";

export interface ProjectWorkspaceDeletionState {
  deletedAt: Date | null;
  workspaceSlug: string | null;
}

export async function isAccountDeletionFenceCurrent(
  db: Database,
  userId: UserId,
  deletionFence: string,
): Promise<boolean> {
  const row = await db.query.users.findFirst({
    columns: { id: true },
    where: and(
      eq(users.id, userId),
      eq(users.deletionFence, deletionFence),
      isNotNull(users.deletedAt),
    ),
  });
  return row !== undefined;
}

export async function loadProjectWorkspaceDeletionState(
  db: Database,
  input: { projectId: ProjectId; userId: UserId },
): Promise<ProjectWorkspaceDeletionState | null> {
  return (
    (await db.query.projects.findFirst({
      columns: { deletedAt: true, workspaceSlug: true },
      where: and(eq(projects.id, input.projectId), eq(projects.userId, input.userId)),
    })) ?? null
  );
}

export async function countOwnedUserRunTargets(
  db: Database,
  input: { runIds: string[]; userId: UserId },
): Promise<number> {
  const rows = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.userId, input.userId), inArray(agentRuns.id, input.runIds)));
  return rows.length;
}

export async function countOwnedThreadRunTargets(
  db: Database,
  input: { runIds: string[]; threadId: ThreadId; userId: UserId },
): Promise<number> {
  const rows = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.userId, input.userId),
        eq(agentRuns.threadId, input.threadId),
        inArray(agentRuns.id, input.runIds),
      ),
    );
  return rows.length;
}

export async function countOwnedProjectRunTargets(
  db: Database,
  input: { projectId: ProjectId; runIds: string[]; userId: UserId },
): Promise<number> {
  const rows = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .innerJoin(threads, eq(threads.id, agentRuns.threadId))
    .where(
      and(
        eq(agentRuns.userId, input.userId),
        eq(threads.userId, input.userId),
        eq(threads.projectId, input.projectId),
        inArray(agentRuns.id, input.runIds),
      ),
    );
  return rows.length;
}
