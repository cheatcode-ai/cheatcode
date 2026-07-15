import { CatalogModelIdSchema, LogicalModelIdSchema, ProjectModeSchema } from "@cheatcode/types";
import { z } from "zod";

export const StartRunInputSchema = z
  .object({
    runId: z.string().uuid(),
    threadId: z.string().uuid(),
    projectId: z.string().uuid(),
    // Immutable /workspace subfolder for this project in the per-user "computer" sandbox. Every
    // run has a project (ensureProjectForRun creates it before the run), so this is always set.
    workspaceSlug: z.string().min(1).max(64),
    sandboxName: z.string().min(1),
    userId: z.string().uuid(),
    messageText: z.string().min(1),
    model: LogicalModelIdSchema,
    // Whether `model` was pinned by the request or project settings (vs Auto). Gates
    // automatic provider fallback so a pinned model is never silently replaced.
    modelExplicit: z.boolean(),
    projectMode: ProjectModeSchema.default("general"),
    isFirstRun: z.boolean().default(false),
    masterInstructions: z.string().trim().min(1).max(20_000).optional(),
    agentDisplayName: z.string().trim().min(1).max(80).optional(),
    globalMemory: z.string().trim().min(1).max(8_000).optional(),
    disabledModels: z.array(CatalogModelIdSchema).max(16).default([]),
    importRepoUrl: z.string().trim().url().max(300).optional(),
  })
  .strict();
export type StartRunInput = z.infer<typeof StartRunInputSchema>;
