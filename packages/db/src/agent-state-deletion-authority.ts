import {
  type InternalAgentStateDeleteBody,
  ProjectId,
  ThreadId,
  type UserId,
} from "@cheatcode/types";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "./client";
import {
  isProjectDeletionGenerationCurrent,
  isThreadDeletionGenerationCurrent,
} from "./project-deletion";
import { agentRuns, projects, threads, users } from "./schema";

/** Proves an exact live database deletion generation before Agent state can be destroyed. */
export async function isAgentStateDeletionAuthorized(
  db: Database,
  userId: UserId,
  body: InternalAgentStateDeleteBody,
): Promise<boolean> {
  if (body.scope === "account") {
    return isAccountDeletionCurrent(db, userId, body.deletionFence);
  }
  if (body.scope === "project") {
    return isProjectWorkspaceDeletionCurrent(db, userId, body);
  }
  return (
    (await isRunDeletionGenerationCurrent(db, userId, body.authority)) &&
    (await areRunDeletionTargetsOwned(db, userId, body))
  );
}

async function isAccountDeletionCurrent(
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

async function isProjectWorkspaceDeletionCurrent(
  db: Database,
  userId: UserId,
  body: Extract<InternalAgentStateDeleteBody, { scope: "project" }>,
): Promise<boolean> {
  const row = await db.query.projects.findFirst({
    columns: { deletedAt: true, workspaceSlug: true },
    where: and(eq(projects.id, body.projectId), eq(projects.userId, userId)),
  });
  return (
    row?.workspaceSlug === body.workspaceSlug &&
    row.deletedAt?.getTime() === new Date(body.deletedAt).getTime()
  );
}

async function isRunDeletionGenerationCurrent(
  db: Database,
  userId: UserId,
  authority: Extract<InternalAgentStateDeleteBody, { scope: "runs" }>["authority"],
): Promise<boolean> {
  if (authority.kind === "account") {
    return isAccountDeletionCurrent(db, userId, authority.deletionFence);
  }
  return authority.kind === "project"
    ? isProjectDeletionGenerationCurrent(db, {
        deletedAt: new Date(authority.deletedAt),
        projectId: ProjectId(authority.projectId),
        userId,
      })
    : isThreadDeletionGenerationCurrent(db, {
        deletedAt: new Date(authority.deletedAt),
        threadId: ThreadId(authority.threadId),
        userId,
      });
}

async function areRunDeletionTargetsOwned(
  db: Database,
  userId: UserId,
  body: Extract<InternalAgentStateDeleteBody, { scope: "runs" }>,
): Promise<boolean> {
  if (body.runIds.length === 0) {
    return true;
  }
  const rows =
    body.authority.kind === "project"
      ? await projectRunIds(db, userId, body.authority.projectId, body.runIds)
      : await db
          .select({ id: agentRuns.id })
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.userId, userId),
              body.authority.kind === "thread"
                ? eq(agentRuns.threadId, body.authority.threadId)
                : undefined,
              inArray(agentRuns.id, body.runIds),
            ),
          );
  return rows.length === body.runIds.length;
}

function projectRunIds(
  db: Database,
  userId: UserId,
  projectId: string,
  runIds: string[],
): Promise<Array<{ id: string }>> {
  return db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .innerJoin(threads, eq(threads.id, agentRuns.threadId))
    .where(
      and(
        eq(agentRuns.userId, userId),
        eq(threads.userId, userId),
        eq(threads.projectId, projectId),
        inArray(agentRuns.id, runIds),
      ),
    );
}
