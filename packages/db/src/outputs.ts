import type { AgentRunId, ProjectId, UserId } from "@cheatcode/types";
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { Database } from "./client";
import { generatedOutputs, users } from "./schema";

export interface ExpiredGeneratedOutputCursor {
  expiresAt: Date;
  id: string;
}

export interface ExpiredGeneratedOutputRecord extends ExpiredGeneratedOutputCursor {
  r2Bucket: string;
  r2Key: string;
}

export interface SaveGeneratedOutputInput {
  agentRunId?: AgentRunId;
  expiresAt: Date;
  filename: string;
  id: string;
  kind: string;
  metadata?: Record<string, unknown>;
  mimeType: string;
  projectId?: ProjectId;
  r2Bucket: string;
  r2Key: string;
  sha256: string;
  sizeBytes: number;
  userId: UserId;
}

export async function saveGeneratedOutput(
  db: Database,
  input: SaveGeneratedOutputInput,
): Promise<{ id: string; isFirstForUser: boolean }> {
  return db.transaction(async (transaction) => {
    const tx = transaction as Database;
    const firstArtifact = await tx
      .update(users)
      .set({ firstArtifactAt: new Date() })
      .where(and(eq(users.id, input.userId), isNull(users.firstArtifactAt)))
      .returning({ id: users.id });
    const rows = await tx
      .insert(generatedOutputs)
      .values({
        expiresAt: input.expiresAt,
        filename: input.filename,
        id: input.id,
        kind: input.kind,
        metadata: input.metadata ?? {},
        mimeType: input.mimeType,
        projectId: input.projectId,
        ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
        r2Bucket: input.r2Bucket,
        r2Key: input.r2Key,
        sha256: input.sha256,
        sizeBytes: input.sizeBytes,
        userId: input.userId,
      })
      .returning({ id: generatedOutputs.id });
    const row = rows[0];
    if (!row) {
      throw new Error("Failed to save generated output");
    }
    return { id: row.id, isFirstForUser: firstArtifact.length > 0 };
  });
}

export async function findGeneratedOutputOwner(
  db: Database,
  outputId: string,
): Promise<{
  expiresAt: Date;
  filename: string;
  mimeType: string;
  r2Key: string;
  userId: string;
} | null> {
  const row = await db.query.generatedOutputs.findFirst({
    columns: { expiresAt: true, filename: true, mimeType: true, r2Key: true, userId: true },
    where: eq(generatedOutputs.id, outputId),
  });
  return row ?? null;
}

/** List a deterministic page for object-first artifact retention cleanup. */
export async function listExpiredGeneratedOutputs(
  db: Database,
  input: {
    before: Date;
    cursor?: ExpiredGeneratedOutputCursor;
    limit: number;
  },
): Promise<ExpiredGeneratedOutputRecord[]> {
  const cursorFilter = input.cursor
    ? or(
        gt(generatedOutputs.expiresAt, input.cursor.expiresAt),
        and(
          eq(generatedOutputs.expiresAt, input.cursor.expiresAt),
          gt(generatedOutputs.id, input.cursor.id),
        ),
      )
    : undefined;
  return db
    .select({
      expiresAt: generatedOutputs.expiresAt,
      id: generatedOutputs.id,
      r2Bucket: generatedOutputs.r2Bucket,
      r2Key: generatedOutputs.r2Key,
    })
    .from(generatedOutputs)
    .where(and(lte(generatedOutputs.expiresAt, input.before), cursorFilter))
    .orderBy(asc(generatedOutputs.expiresAt), asc(generatedOutputs.id))
    .limit(input.limit);
}

/**
 * Delete rows only after their exact R2 identities were removed. Identity checks
 * keep an unexpected concurrent repair from deleting a newly repointed record.
 */
export async function deleteExpiredGeneratedOutputs(
  db: Database,
  input: { before: Date; outputs: ExpiredGeneratedOutputRecord[] },
): Promise<number> {
  if (input.outputs.length === 0) {
    return 0;
  }
  const identities = input.outputs.map((output) =>
    and(
      eq(generatedOutputs.id, output.id),
      eq(generatedOutputs.expiresAt, output.expiresAt),
      eq(generatedOutputs.r2Bucket, output.r2Bucket),
      eq(generatedOutputs.r2Key, output.r2Key),
    ),
  );
  const rows = await db
    .delete(generatedOutputs)
    .where(and(lte(generatedOutputs.expiresAt, input.before), or(...identities)))
    .returning({ id: generatedOutputs.id });
  return rows.length;
}
