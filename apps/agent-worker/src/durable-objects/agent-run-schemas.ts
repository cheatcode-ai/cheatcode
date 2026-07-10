import { z } from "zod";

export const StartRunInputSchema = z
  .object({
    runId: z.string().min(1),
    threadId: z.string().min(1),
    projectId: z.string().min(1),
    // Immutable /workspace subfolder for this project in the per-user "computer" sandbox. Every
    // run has a project (ensureProjectForRun creates it before the run), so this is always set.
    workspaceSlug: z.string().min(1).max(64),
    sandboxName: z.string().min(1),
    userId: z.string().uuid(),
    messageText: z.string().min(1),
    model: z.string().trim().min(1).max(200).optional(),
    // Whether the user explicitly picked `model` (vs an Auto/implicit default). Gates
    // the free-DeepSeek last-resort fallback so explicit non-free picks aren't swapped.
    modelExplicit: z.boolean().optional(),
    projectMode: z.enum(["app-builder", "app-builder-mobile", "general"]).default("general"),
    isFirstRun: z.boolean().default(false),
    researchFanoutSubagentLimit: z.number().int().positive().max(25).default(3),
    masterInstructions: z.string().trim().min(1).max(20_000).optional(),
    agentDisplayName: z.string().trim().min(1).max(80).optional(),
    globalMemory: z.string().trim().min(1).max(8_000).optional(),
    disabledModels: z.array(z.string().trim().min(1).max(200)).max(16).default([]),
    importRepoUrl: z.string().trim().url().max(300).optional(),
    budgetCapUsd: z.number().positive().max(50).optional(),
    dailyCostCapUsd: z.number().positive().optional(),
    dailyCostUsdAtRunStart: z.number().nonnegative().default(0),
    quotaWarning: z
      .object({
        feature: z.literal("sandbox_hours"),
        limit: z.number().nonnegative(),
        remaining: z.number().nonnegative(),
        resetAt: z.number().int().positive(),
      })
      .strict()
      .optional(),
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
    pendingApproval: z
      .object({
        approvalId: z.string().uuid(),
        expiresAt: z.number().int(),
        kind: z.enum(["tool-approval", "model-fallback"]),
        requestedAt: z.number().int(),
        summary: z.string(),
        timeoutDecision: z.enum(["allow", "deny"]),
        toolName: z.string().optional(),
      })
      .strict()
      .optional(),
    runId: z.string().min(1),
    startedAt: z.number().int().nullable(),
    status: z.enum(["idle", "running", "paused", "completed", "failed", "canceled"]),
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
