import type { AgentRunId, ProjectId, UserId } from "@cheatcode/types";
import { eq } from "drizzle-orm";
import type { Database } from "./client";
import { generatedOutputs } from "./schema";

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
