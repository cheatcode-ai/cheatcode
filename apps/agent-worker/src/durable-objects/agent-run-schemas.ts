import {
  CatalogModelIdSchema,
  LogicalModelIdSchema,
  ProjectModeSchema,
  RunIntentSchema,
} from "@cheatcode/types";
import { z } from "zod";

export const StartRunInputSchema = z
  .object({
    runId: z.string().uuid(),
    threadId: z.string().uuid(),
    projectId: z.string().uuid().optional(),
    workspaceSlug: z.string().min(1).max(64).optional(),
    sandboxName: z.string().min(1),
    userId: z.string().uuid(),
    messageText: z.string().min(1),
    model: LogicalModelIdSchema,
    // Whether `model` was pinned by the request or project settings (vs Auto). Gates
    // automatic provider fallback so a pinned model is never silently replaced.
    modelExplicit: z.boolean(),
    runIntent: RunIntentSchema.optional(),
    projectMode: ProjectModeSchema.default("general"),
    isFirstRun: z.boolean().default(false),
    agentDisplayName: z.string().trim().min(1).max(80).optional(),
    globalMemory: z.string().trim().min(1).max(8_000).optional(),
    disabledModels: z.array(CatalogModelIdSchema).max(16).default([]),
    importRepoUrl: z.string().trim().url().max(300).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.projectId) === Boolean(value.workspaceSlug), {
    message: "projectId and workspaceSlug must be supplied together",
  });
export type StartRunInput = z.infer<typeof StartRunInputSchema>;
