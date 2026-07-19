import { AgentRunId, type ProjectId, type ThreadId, type UserId } from "@cheatcode/types";
import { and, asc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import { lockUserProjectMutations } from "./projects";
import { agentRuns, artifactUploadIntents, generatedOutputs, projects, threads } from "./schema";

const MAX_DELETION_PAGE_SIZE = 100;

export type ProjectDeletionOutputRecord = {
  id: string;
  r2Key: string;
} & ({ recordType: "generated-output" } | { recordType: "upload-intent" });

export type ResourceDeletionScope =
  | { deletedAt: Date; kind: "project-deletion"; projectId: ProjectId; userId: UserId }
  | { deletedAt: Date; kind: "thread-deletion"; threadId: ThreadId; userId: UserId };

export class ResourceDeletionInvariantError extends Error {
  public readonly retriable = false;
}

interface DeletionPageInput {
  cursor?: string;
  limit: number;
  userId: UserId;
}

export async function listProjectDeletionOutputs(
  db: Database,
  input: DeletionPageInput & { projectId: ProjectId },
): Promise<ProjectDeletionOutputRecord[]> {
  const outputs = await db
    .select(outputSelection())
    .from(generatedOutputs)
    .innerJoin(agentRuns, runOwnsOutput())
    .innerJoin(threads, runBelongsToThread())
    .where(
      and(
        eq(generatedOutputs.userId, input.userId),
        eq(threads.projectId, input.projectId),
        input.cursor ? gt(generatedOutputs.id, input.cursor) : undefined,
      ),
    )
    .orderBy(asc(generatedOutputs.id))
    .limit(deletionPageSize(input.limit));
  const intents = await db
    .select(intentSelection())
    .from(artifactUploadIntents)
    .where(
      and(
        eq(artifactUploadIntents.userId, input.userId),
        eq(artifactUploadIntents.projectId, input.projectId),
        input.cursor ? gt(artifactUploadIntents.id, input.cursor) : undefined,
      ),
    )
    .orderBy(asc(artifactUploadIntents.id))
    .limit(deletionPageSize(input.limit));
  return mergeDeletionRecords(outputs, intents, input.limit);
}

export async function listThreadDeletionOutputs(
  db: Database,
  input: DeletionPageInput & { threadId: ThreadId },
): Promise<ProjectDeletionOutputRecord[]> {
  const outputs = await db
    .select(outputSelection())
    .from(generatedOutputs)
    .innerJoin(agentRuns, runOwnsOutput())
    .where(
      and(
        eq(agentRuns.userId, input.userId),
        eq(agentRuns.threadId, input.threadId),
        input.cursor ? gt(generatedOutputs.id, input.cursor) : undefined,
      ),
    )
    .orderBy(asc(generatedOutputs.id))
    .limit(deletionPageSize(input.limit));
  const intents = await db
    .select(intentSelection())
    .from(artifactUploadIntents)
    .innerJoin(
      agentRuns,
      and(
        eq(agentRuns.id, artifactUploadIntents.agentRunId),
        eq(agentRuns.userId, artifactUploadIntents.userId),
      ),
    )
    .where(
      and(
        eq(agentRuns.userId, input.userId),
        eq(agentRuns.threadId, input.threadId),
        input.cursor ? gt(artifactUploadIntents.id, input.cursor) : undefined,
      ),
    )
    .orderBy(asc(artifactUploadIntents.id))
    .limit(deletionPageSize(input.limit));
  return mergeDeletionRecords(outputs, intents, input.limit);
}

export async function deleteResourceDeletionOutputRecords(
  db: Database,
  scope: ResourceDeletionScope,
  outputs: readonly ProjectDeletionOutputRecord[],
): Promise<{ current: boolean; deleted: number }> {
  if (outputs.length === 0) {
    return { current: await isResourceDeletionGenerationCurrent(db, scope), deleted: 0 };
  }
  if (!(await isResourceDeletionGenerationCurrent(db, scope))) {
    return { current: false, deleted: 0 };
  }
  const outputRows = await deleteGeneratedOutputRecords(db, scope.userId, outputs);
  const intentRows = await deleteResourceIntents(db, scope.userId, outputs);
  const deleted = outputRows + intentRows;
  const remaining = await countRemainingDeletionRecords(db, scope.userId, outputs);
  return {
    current: true,
    deleted: remaining === 0 ? outputs.length : deleted,
  };
}

export async function listProjectDeletionRunIds(
  db: Database,
  input: DeletionPageInput & { projectId: ProjectId },
): Promise<AgentRunId[]> {
  const rows = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .innerJoin(threads, runBelongsToThread())
    .where(
      and(
        eq(agentRuns.userId, input.userId),
        eq(threads.projectId, input.projectId),
        input.cursor ? gt(agentRuns.id, input.cursor) : undefined,
      ),
    )
    .orderBy(asc(agentRuns.id))
    .limit(deletionPageSize(input.limit));
  return rows.map((row) => AgentRunId(row.id));
}

export async function listThreadDeletionRunIds(
  db: Database,
  input: DeletionPageInput & { threadId: ThreadId },
): Promise<AgentRunId[]> {
  const rows = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.userId, input.userId),
        eq(agentRuns.threadId, input.threadId),
        input.cursor ? gt(agentRuns.id, input.cursor) : undefined,
      ),
    )
    .orderBy(asc(agentRuns.id))
    .limit(deletionPageSize(input.limit));
  return rows.map((row) => AgentRunId(row.id));
}

export async function isProjectDeletionGenerationCurrent(
  db: Database,
  input: { deletedAt: Date; projectId: ProjectId; userId: UserId },
): Promise<boolean> {
  const row = await db.query.projects.findFirst({
    columns: { deletedAt: true },
    where: and(eq(projects.id, input.projectId), eq(projects.userId, input.userId)),
  });
  if (!row) {
    return false;
  }
  return sameDeletionGeneration(row.deletedAt, input.deletedAt);
}

export async function isThreadDeletionGenerationCurrent(
  db: Database,
  input: { deletedAt: Date; threadId: ThreadId; userId: UserId },
): Promise<boolean> {
  const row = await db.query.threads.findFirst({
    columns: { deletedAt: true, projectId: true },
    where: and(eq(threads.id, input.threadId), eq(threads.userId, input.userId)),
  });
  if (!row || !sameDeletionGeneration(row.deletedAt, input.deletedAt)) {
    return false;
  }
  if (!row.projectId) {
    return true;
  }
  const parent = await db.query.projects.findFirst({
    columns: { deletedAt: true },
    where: and(eq(projects.id, row.projectId), eq(projects.userId, input.userId)),
  });
  return parent?.deletedAt === null;
}

export async function isResourceDeletionGenerationCurrent(
  db: Database,
  scope: ResourceDeletionScope,
): Promise<boolean> {
  return scope.kind === "project-deletion"
    ? isProjectDeletionGenerationCurrent(db, scope)
    : isThreadDeletionGenerationCurrent(db, scope);
}

export async function clearProjectDeletionRunPointers(
  db: Database,
  input: { deletedAt: Date; projectId: ProjectId; userId: UserId },
): Promise<{ cleared: number; current: boolean }> {
  if (!(await isProjectDeletionGenerationCurrent(db, input))) {
    return { cleared: 0, current: false };
  }
  const rows = await db
    .update(threads)
    .set({ activeRunId: null })
    .where(
      and(
        eq(threads.projectId, input.projectId),
        eq(threads.userId, input.userId),
        isNotNull(threads.activeRunId),
      ),
    )
    .returning({ id: threads.id });
  return { cleared: rows.length, current: true };
}

export async function clearThreadDeletionRunPointer(
  db: Database,
  input: { deletedAt: Date; threadId: ThreadId; userId: UserId },
): Promise<{ cleared: boolean; current: boolean }> {
  if (!(await isThreadDeletionGenerationCurrent(db, input))) {
    return { cleared: false, current: false };
  }
  const rows = await db
    .update(threads)
    .set({ activeRunId: null })
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.userId, input.userId),
        isNotNull(threads.activeRunId),
      ),
    )
    .returning({ id: threads.id });
  return { cleared: rows.length > 0, current: true };
}

export async function finalizeProjectDeletion(
  db: Database,
  input: { deletedAt: Date; projectId: ProjectId; userId: UserId },
): Promise<boolean> {
  await lockUserProjectMutations(db, input.userId);
  if (!(await projectExists(db, input.projectId, input.userId))) {
    return true;
  }
  if (!(await isProjectDeletionGenerationCurrent(db, input))) {
    return false;
  }
  if (await projectHasOutputs(db, input.projectId, input.userId)) {
    throw new ResourceDeletionInvariantError(
      "Project deletion refused while generated outputs still exist",
    );
  }
  if (await projectHasActiveRunPointer(db, input.projectId, input.userId)) {
    throw new ResourceDeletionInvariantError(
      "Project deletion refused while an active run pointer still exists",
    );
  }
  const rows = await db
    .delete(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.userId, input.userId),
        eq(projects.deletedAt, input.deletedAt),
      ),
    )
    .returning({ id: projects.id });
  return rows.length === 1;
}

export async function finalizeThreadDeletion(
  db: Database,
  input: { deletedAt: Date; threadId: ThreadId; userId: UserId },
): Promise<boolean> {
  await lockUserProjectMutations(db, input.userId);
  if (!(await threadExists(db, input.threadId, input.userId))) {
    return true;
  }
  if (!(await isThreadDeletionGenerationCurrent(db, input))) {
    return false;
  }
  if (await threadHasOutputs(db, input.threadId, input.userId)) {
    throw new ResourceDeletionInvariantError(
      "Thread deletion refused while generated outputs still exist",
    );
  }
  const rows = await db
    .delete(threads)
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.userId, input.userId),
        eq(threads.deletedAt, input.deletedAt),
        isNull(threads.activeRunId),
      ),
    )
    .returning({ id: threads.id });
  return rows.length === 1;
}

function runOwnsOutput() {
  return and(
    eq(agentRuns.id, generatedOutputs.agentRunId),
    eq(agentRuns.userId, generatedOutputs.userId),
  );
}

function runBelongsToThread() {
  return and(eq(threads.id, agentRuns.threadId), eq(threads.userId, agentRuns.userId));
}

function outputIdentity(userId: UserId, output: ProjectDeletionOutputRecord) {
  return and(
    eq(generatedOutputs.id, output.id),
    eq(generatedOutputs.userId, userId),
    eq(generatedOutputs.r2Key, output.r2Key),
  );
}

function outputSelection() {
  return {
    id: generatedOutputs.id,
    recordType: sql<"generated-output">`'generated-output'::text`,
    r2Key: generatedOutputs.r2Key,
  };
}

function intentSelection() {
  return {
    id: artifactUploadIntents.id,
    recordType: sql<"upload-intent">`'upload-intent'::text`,
    r2Key: artifactUploadIntents.r2Key,
  };
}

function mergeDeletionRecords(
  outputs: ProjectDeletionOutputRecord[],
  intents: ProjectDeletionOutputRecord[],
  limit: number,
): ProjectDeletionOutputRecord[] {
  return [...outputs, ...intents]
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, deletionPageSize(limit));
}

async function deleteResourceIntents(
  db: Database,
  userId: UserId,
  outputs: readonly ProjectDeletionOutputRecord[],
): Promise<number> {
  const intents = outputs.filter((output) => output.recordType === "upload-intent");
  if (intents.length === 0) {
    return 0;
  }
  const rows = await db
    .delete(artifactUploadIntents)
    .where(
      or(
        ...intents.map((output) =>
          and(
            eq(artifactUploadIntents.id, output.id),
            eq(artifactUploadIntents.userId, userId),
            eq(artifactUploadIntents.r2Key, output.r2Key),
          ),
        ),
      ),
    )
    .returning({ id: artifactUploadIntents.id });
  return rows.length;
}

async function deleteGeneratedOutputRecords(
  db: Database,
  userId: UserId,
  outputs: readonly ProjectDeletionOutputRecord[],
): Promise<number> {
  const generated = outputs.filter((output) => output.recordType === "generated-output");
  if (generated.length === 0) {
    return 0;
  }
  const rows = await db
    .delete(generatedOutputs)
    .where(or(...generated.map((output) => outputIdentity(userId, output))))
    .returning({ id: generatedOutputs.id });
  return rows.length;
}

async function countRemainingDeletionRecords(
  db: Database,
  userId: UserId,
  outputs: readonly ProjectDeletionOutputRecord[],
): Promise<number> {
  const generated = outputs.filter((output) => output.recordType === "generated-output");
  const intents = outputs.filter((output) => output.recordType === "upload-intent");
  const outputRows = generated.length === 0 ? [] : await remainingOutputs(db, userId, generated);
  const intentRows = intents.length === 0 ? [] : await remainingIntents(db, userId, intents);
  return outputRows.length + intentRows.length;
}

function remainingOutputs(
  db: Database,
  userId: UserId,
  outputs: readonly ProjectDeletionOutputRecord[],
) {
  return db
    .select({ id: generatedOutputs.id })
    .from(generatedOutputs)
    .where(or(...outputs.map((output) => outputIdentity(userId, output))));
}

function remainingIntents(
  db: Database,
  userId: UserId,
  outputs: readonly ProjectDeletionOutputRecord[],
) {
  return db
    .select({ id: artifactUploadIntents.id })
    .from(artifactUploadIntents)
    .where(
      or(
        ...outputs.map((output) =>
          and(
            eq(artifactUploadIntents.id, output.id),
            eq(artifactUploadIntents.userId, userId),
            eq(artifactUploadIntents.r2Key, output.r2Key),
          ),
        ),
      ),
    );
}

async function projectHasOutputs(
  db: Database,
  projectId: ProjectId,
  userId: UserId,
): Promise<boolean> {
  const row = await listProjectDeletionOutputs(db, { limit: 1, projectId, userId });
  return row.length > 0;
}

async function projectHasActiveRunPointer(
  db: Database,
  projectId: ProjectId,
  userId: UserId,
): Promise<boolean> {
  const row = await db.query.threads.findFirst({
    columns: { id: true },
    where: and(
      eq(threads.projectId, projectId),
      eq(threads.userId, userId),
      isNotNull(threads.activeRunId),
    ),
  });
  return Boolean(row);
}

async function threadHasOutputs(
  db: Database,
  threadId: ThreadId,
  userId: UserId,
): Promise<boolean> {
  const row = await listThreadDeletionOutputs(db, { limit: 1, threadId, userId });
  return row.length > 0;
}

async function projectExists(db: Database, projectId: ProjectId, userId: UserId): Promise<boolean> {
  const row = await db.query.projects.findFirst({
    columns: { id: true },
    where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
  });
  return Boolean(row);
}

async function threadExists(db: Database, threadId: ThreadId, userId: UserId): Promise<boolean> {
  const row = await db.query.threads.findFirst({
    columns: { id: true },
    where: and(eq(threads.id, threadId), eq(threads.userId, userId)),
  });
  return Boolean(row);
}

function sameDeletionGeneration(actual: Date | null, expected: Date): boolean {
  return actual?.getTime() === expected.getTime();
}

function deletionPageSize(limit: number): number {
  return Math.max(1, Math.min(MAX_DELETION_PAGE_SIZE, Math.trunc(limit)));
}
