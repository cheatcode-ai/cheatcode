import type { UserId } from "@cheatcode/types";
import { and, eq } from "drizzle-orm";
import type { Database } from "./client";
import { generatedOutputs } from "./schema";

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
