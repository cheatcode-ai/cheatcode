import type { ProjectId, UserId } from "@cheatcode/types";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "./client";
import { agentRuns, generatedOutputs, threads } from "./schema";

interface ProjectGeneratedOutputRecord {
  filename: string;
  id: string;
  mimeType: string;
}

export interface ReferencedProjectGeneratedOutputRecord extends ProjectGeneratedOutputRecord {
  r2Key: string;
}

export async function findGeneratedOutput(
  db: Database,
  input: { outputId: string; userId: UserId },
): Promise<{
  filename: string;
  mimeType: string;
  r2Key: string;
} | null> {
  const row = await db.query.generatedOutputs.findFirst({
    columns: { filename: true, mimeType: true, r2Key: true },
    where: and(eq(generatedOutputs.id, input.outputId), eq(generatedOutputs.userId, input.userId)),
  });
  return row ?? null;
}

export async function listProjectGeneratedOutputs(
  db: Database,
  input: { limit: number; projectId: ProjectId; userId: UserId },
): Promise<ProjectGeneratedOutputRecord[]> {
  return db
    .select({
      filename: generatedOutputs.filename,
      id: generatedOutputs.id,
      mimeType: generatedOutputs.mimeType,
    })
    .from(generatedOutputs)
    .innerJoin(agentRuns, runOwnsOutput())
    .innerJoin(threads, runBelongsToThread())
    .where(projectOutputScope(input.projectId, input.userId))
    .orderBy(desc(agentRuns.id), desc(generatedOutputs.id))
    .limit(input.limit);
}

export async function listReferencedProjectGeneratedOutputs(
  db: Database,
  input: { outputIds: readonly string[]; projectId: ProjectId; userId: UserId },
): Promise<ReferencedProjectGeneratedOutputRecord[]> {
  if (input.outputIds.length === 0) return [];
  return db
    .select({
      filename: generatedOutputs.filename,
      id: generatedOutputs.id,
      mimeType: generatedOutputs.mimeType,
      r2Key: generatedOutputs.r2Key,
    })
    .from(generatedOutputs)
    .innerJoin(agentRuns, runOwnsOutput())
    .innerJoin(threads, runBelongsToThread())
    .where(
      and(
        projectOutputScope(input.projectId, input.userId),
        inArray(generatedOutputs.id, [...input.outputIds]),
      ),
    );
}

function projectOutputScope(projectId: ProjectId, userId: UserId) {
  return and(eq(generatedOutputs.userId, userId), eq(threads.projectId, projectId));
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
