/** Single authority for agent-state deletion authorization, enforced in the withUserContext transaction before any Agent durable-state mutation. */

import {
  countOwnedProjectRunTargets,
  countOwnedThreadRunTargets,
  countOwnedUserRunTargets,
  type Database,
  isAccountDeletionFenceCurrent,
  isProjectDeletionGenerationCurrent,
  isThreadDeletionGenerationCurrent,
  loadProjectWorkspaceDeletionState,
} from "@cheatcode/db";
import {
  type InternalAgentStateDeleteBody,
  ProjectId,
  ThreadId,
  type UserId,
} from "@cheatcode/types";

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
  return isAccountDeletionFenceCurrent(db, userId, deletionFence);
}

async function isProjectWorkspaceDeletionCurrent(
  db: Database,
  userId: UserId,
  body: Extract<InternalAgentStateDeleteBody, { scope: "project" }>,
): Promise<boolean> {
  const state = await loadProjectWorkspaceDeletionState(db, {
    projectId: ProjectId(body.projectId),
    userId,
  });
  return (
    state?.workspaceSlug === body.workspaceSlug &&
    state.deletedAt?.getTime() === new Date(body.deletedAt).getTime()
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
  const owned =
    body.authority.kind === "project"
      ? await countOwnedProjectRunTargets(db, {
          projectId: ProjectId(body.authority.projectId),
          runIds: body.runIds,
          userId,
        })
      : body.authority.kind === "thread"
        ? await countOwnedThreadRunTargets(db, {
            runIds: body.runIds,
            threadId: ThreadId(body.authority.threadId),
            userId,
          })
        : await countOwnedUserRunTargets(db, { runIds: body.runIds, userId });
  return owned === body.runIds.length;
}
