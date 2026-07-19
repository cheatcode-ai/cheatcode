import {
  CanonicalProjectWorkspaceSlugSchema,
  ProjectId,
  UserId,
  type WorkspaceTransitionProject,
} from "@cheatcode/types";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { canonicalWorkspaceSlugForProject, lockUserProjectMutations } from "./projects";
import { projects, users } from "./schema";

const DATABASE_MAINTENANCE_LOCK = "cheatcode:database-maintenance:v1";

export interface WorkspaceTransitionOwner {
  projects: WorkspaceTransitionProject[];
  userId: UserId;
}

export interface WorkspaceTransitionOwnerIdPage {
  nextCursor: UserId | null;
  ownerIds: UserId[];
}

export class WorkspaceTransitionInvariantError extends Error {
  public readonly retriable = false;
}

export async function listWorkspaceTransitionOwnerIdPage(
  db: Database,
  input: { cursor?: UserId; limit: number },
): Promise<WorkspaceTransitionOwnerIdPage> {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
  const ownerRows = await db
    .select({ userId: users.id })
    .from(users)
    .where(and(isNull(users.deletedAt), input.cursor ? gt(users.id, input.cursor) : undefined))
    .orderBy(asc(users.id))
    .limit(limit + 1);
  const selectedOwners = ownerRows.slice(0, limit);
  const lastSelectedOwner = selectedOwners.at(-1);
  return {
    nextCursor:
      ownerRows.length > limit && lastSelectedOwner ? UserId(lastSelectedOwner.userId) : null,
    ownerIds: selectedOwners.map((owner) => UserId(owner.userId)),
  };
}

export async function loadWorkspaceTransitionOwner(
  db: Database,
  userId: UserId,
): Promise<WorkspaceTransitionOwner | null> {
  const owner = await db.query.users.findFirst({
    columns: { id: true },
    where: and(eq(users.id, userId), isNull(users.deletedAt)),
  });
  if (!owner) {
    return null;
  }
  const rows = await db
    .select({ id: projects.id, name: projects.name, workspaceSlug: projects.workspaceSlug })
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)))
    .orderBy(asc(projects.id));
  return { projects: rows.map(workspaceTransitionProject), userId };
}

export async function applyCanonicalWorkspaceTransition(
  db: Database,
  input: { projects: WorkspaceTransitionProject[]; userId: UserId },
): Promise<{ updated: number }> {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.user_id', ${input.userId}, true)`);
    await acquireMaintenanceFence(transaction);
    await lockUserProjectMutations(transaction as Database, input.userId);
    const current = await lockedActiveProjects(transaction as Database, input.userId);
    assertTransitionMatchesProjects(current, input.projects);
    let updated = 0;
    for (const project of input.projects) {
      if (project.currentWorkspaceSlug === project.canonicalWorkspaceSlug) {
        continue;
      }
      const rows = await transaction
        .update(projects)
        .set({ workspaceSlug: project.canonicalWorkspaceSlug })
        .where(
          and(
            eq(projects.id, project.projectId),
            eq(projects.userId, input.userId),
            eq(projects.workspaceSlug, project.currentWorkspaceSlug),
            isNull(projects.deletedAt),
          ),
        )
        .returning({ id: projects.id });
      if (rows.length > 1) {
        throw new WorkspaceTransitionInvariantError("Workspace transition updated multiple rows.");
      }
      updated += rows.length;
    }
    const finalized = await lockedActiveProjects(transaction as Database, input.userId);
    assertCanonicalTransitionApplied(finalized, input.projects);
    return { updated };
  });
}

async function acquireMaintenanceFence(db: Database): Promise<void> {
  const result = await db.execute(sql`
    select pg_try_advisory_xact_lock(
      hashtextextended(${DATABASE_MAINTENANCE_LOCK}, 0)
    ) as locked
  `);
  if (result.rows[0]?.["locked"] !== true) {
    throw new WorkspaceTransitionInvariantError(
      "Another database maintenance operation owns the workspace transition fence.",
    );
  }
}

async function lockedActiveProjects(db: Database, userId: UserId) {
  return db
    .select({ id: projects.id, name: projects.name, workspaceSlug: projects.workspaceSlug })
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)))
    .orderBy(asc(projects.id))
    .for("update");
}

function assertTransitionMatchesProjects(
  current: Awaited<ReturnType<typeof lockedActiveProjects>>,
  requested: WorkspaceTransitionProject[],
): void {
  if (current.length !== requested.length) {
    throw new WorkspaceTransitionInvariantError(
      "Active project inventory changed during transition.",
    );
  }
  const requestedById = new Map(requested.map((project) => [project.projectId, project]));
  for (const project of current) {
    const request = requestedById.get(project.id);
    const canonical = transitionCanonicalSlug(project);
    if (
      !request ||
      request.canonicalWorkspaceSlug !== canonical ||
      (project.workspaceSlug !== request.currentWorkspaceSlug &&
        project.workspaceSlug !== canonical)
    ) {
      throw new WorkspaceTransitionInvariantError(
        "Active project workspace identity changed during transition.",
      );
    }
  }
}

function assertCanonicalTransitionApplied(
  current: Awaited<ReturnType<typeof lockedActiveProjects>>,
  requested: WorkspaceTransitionProject[],
): void {
  const canonicalById = new Map(
    requested.map((project) => [project.projectId, project.canonicalWorkspaceSlug]),
  );
  if (
    current.length !== requested.length ||
    current.some((project) => canonicalById.get(project.id) !== project.workspaceSlug)
  ) {
    throw new WorkspaceTransitionInvariantError("Canonical workspace update did not converge.");
  }
}

function workspaceTransitionProject(row: {
  id: string;
  name: string;
  workspaceSlug: string;
}): WorkspaceTransitionProject {
  const projectId = ProjectId(row.id);
  return {
    canonicalWorkspaceSlug: transitionCanonicalSlug(row),
    currentWorkspaceSlug: row.workspaceSlug,
    projectId,
  };
}

function transitionCanonicalSlug(row: { id: string; name: string; workspaceSlug: string }): string {
  const projectId = ProjectId(row.id);
  const parsed = CanonicalProjectWorkspaceSlugSchema.safeParse(row.workspaceSlug);
  return parsed.success && parsed.data.endsWith(`-${projectId}`)
    ? parsed.data
    : canonicalWorkspaceSlugForProject(row.name, projectId);
}
