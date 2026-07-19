import { z } from "zod";
import { LogicalModelIdSchema } from "./models";

export const RunStatusSnapshotSchema = z
  .object({
    completedAt: z.number().int().nullable(),
    createdAt: z.number().int(),
    lastSeq: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    modelId: LogicalModelIdSchema,
    ok: z.literal(true),
    runId: z.string().min(1),
    startedAt: z.number().int().nullable(),
    status: z.enum(["idle", "running", "completed", "failed", "canceled"]),
    summary: z.string(),
  })
  .strict();
