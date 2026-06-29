import type { AgentRunId, ProjectId, UserId } from "@cheatcode/types";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { Database } from "./client";
import { generatedOutputs } from "./schema";

export interface GeneratedOutputRecord {
  id: string;
  kind: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface SaveGeneratedOutputInput {
  agentRunId?: AgentRunId;
  expiresAt?: Date;
  filename: string;
  id: string;
  kind: string;
  metadata?: Record<string, unknown>;
  mimeType: string;
  projectId?: ProjectId;
  r2Bucket: string;
  r2Key: string;
  sha256?: string;
  sizeBytes: number;
  userId: UserId;
}

export async function saveGeneratedOutput(
  db: Database,
  input: SaveGeneratedOutputInput,
): Promise<string> {
  const rows = await db
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
  return row.id;
}

export async function hasGeneratedOutputForUser(db: Database, userId: UserId): Promise<boolean> {
  const rows = await db
    .select({ id: generatedOutputs.id })
    .from(generatedOutputs)
    .where(eq(generatedOutputs.userId, userId))
    .limit(1);
  return rows.length > 0;
}

/** A user's generated artifacts, newest first, excluding ones already past expiry. */
export async function listGeneratedOutputsByUser(
  db: Database,
  userId: UserId,
  now: Date,
  limit = 100,
): Promise<GeneratedOutputRecord[]> {
  return db
    .select({
      id: generatedOutputs.id,
      kind: generatedOutputs.kind,
      filename: generatedOutputs.filename,
      mimeType: generatedOutputs.mimeType,
      sizeBytes: generatedOutputs.sizeBytes,
      createdAt: generatedOutputs.createdAt,
      expiresAt: generatedOutputs.expiresAt,
    })
    .from(generatedOutputs)
    .where(
      and(
        eq(generatedOutputs.userId, userId),
        or(isNull(generatedOutputs.expiresAt), gt(generatedOutputs.expiresAt, now)),
      ),
    )
    .orderBy(desc(generatedOutputs.createdAt))
    .limit(limit);
}

export async function findGeneratedOutputOwner(
  db: Database,
  outputId: string,
): Promise<{
  expiresAt: Date | null;
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
