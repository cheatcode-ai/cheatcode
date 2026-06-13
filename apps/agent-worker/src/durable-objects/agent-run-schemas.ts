import { z } from "zod";

export const StartRunInputSchema = z
  .object({
    runId: z.string().min(1),
    threadId: z.string().min(1),
    projectId: z.string().min(1),
    sandboxName: z.string().min(1),
    userId: z.string().uuid(),
    messageText: z.string().min(1),
    model: z.string().trim().min(1).max(200).optional(),
    projectMode: z.enum(["app-builder", "app-builder-mobile", "general"]).default("general"),
    isFirstRun: z.boolean().default(false),
    researchFanoutSubagentLimit: z.number().int().positive().max(25).default(3),
    masterInstructions: z.string().trim().min(1).max(20_000).optional(),
    agentDisplayName: z.string().trim().min(1).max(80).optional(),
    globalMemory: z.string().trim().min(1).max(8_000).optional(),
    disabledModels: z.array(z.string().trim().min(1).max(200)).max(16).default([]),
    budgetCapUsd: z.number().positive().max(50).optional(),
    dailyCostCapUsd: z.number().positive().optional(),
    dailyCostUsdAtRunStart: z.number().nonnegative().default(0),
  })
  .strict();
export type StartRunInput = z.infer<typeof StartRunInputSchema>;

export const RunStatusSnapshotSchema = z
  .object({
    budget: z
      .object({
        capUsd: z.number().nonnegative(),
        tokensIn: z.number().int().nonnegative(),
        tokensOut: z.number().int().nonnegative(),
        usdSpent: z.number().nonnegative(),
      })
      .strict(),
    completedAt: z.number().int().nullable(),
    createdAt: z.number().int(),
    lastSeq: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    modelId: z.string().min(1),
    ok: z.literal(true),
    runId: z.string().min(1),
    startedAt: z.number().int().nullable(),
    status: z.enum(["idle", "running", "completed", "failed", "canceled"]),
    summary: z.string(),
  })
  .strict();

export const TakeoverStateInputSchema = z
  .object({
    expiresAt: z.number().int().positive(),
    resumeToken: z.string().min(32).max(200),
    userId: z.string().uuid(),
  })
  .strict();
export type TakeoverStateInput = z.infer<typeof TakeoverStateInputSchema>;

export const ResumeTakeoverInputSchema = z
  .object({
    now: z.number().int().positive().optional(),
    resumeToken: z.string().min(32).max(200),
    userId: z.string().uuid(),
  })
  .strict();
export type ResumeTakeoverInput = z.infer<typeof ResumeTakeoverInputSchema>;
