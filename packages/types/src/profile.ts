import { z } from "zod";
import { CatalogModelIdSchema } from "./models";

export const OnboardingStepSchema = z.enum(["intro", "name", "tools", "basics", "plan"]);
export const OnboardingStepStatusSchema = z.enum(["done", "skipped"]);

export const OnboardingStateSchema = z
  .object({
    steps: z.partialRecord(OnboardingStepSchema, OnboardingStepStatusSchema).default({}),
  })
  .strict();

// `disabledModels.max(3)` encodes "≥1 catalog model stays enabled" structurally (catalog has 4 entries).
const DisabledModelsSchema = z.array(CatalogModelIdSchema).max(3);
const SurfaceBudgetSchema = z.number().positive().max(50); // 0 < n ≤ $50; null = No cap

export const UserProfileSchema = z
  .object({
    agentDisplayName: z.string().min(1).max(80).nullable(),
    appbuilderDefaultBudgetUsd: SurfaceBudgetSchema.nullable(),
    appbuilderDefaultModel: CatalogModelIdSchema.nullable(),
    disabledModels: DisabledModelsSchema,
    generalDefaultBudgetUsd: SurfaceBudgetSchema.nullable(),
    generalDefaultModel: CatalogModelIdSchema.nullable(),
    globalMemory: z.string().max(8_000).nullable(),
    onboardingCompletedAt: z.string().datetime().nullable(),
    onboardingState: OnboardingStateSchema,
    updatedAt: z.string().datetime().nullable(),
  })
  .strict();

export const UpdateUserProfileSchema = z
  .object({
    agentDisplayName: z.string().trim().min(1).max(80).nullable().optional(),
    appbuilderDefaultBudgetUsd: SurfaceBudgetSchema.nullable().optional(),
    appbuilderDefaultModel: CatalogModelIdSchema.nullable().optional(),
    disabledModels: DisabledModelsSchema.optional(),
    generalDefaultBudgetUsd: SurfaceBudgetSchema.nullable().optional(),
    generalDefaultModel: CatalogModelIdSchema.nullable().optional(),
    globalMemory: z.string().max(8_000).nullable().optional(),
    onboardingCompleted: z.literal(true).optional(),
    onboardingStep: z
      .object({ status: OnboardingStepStatusSchema, step: OnboardingStepSchema })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field is required.",
  });

export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;
export type OnboardingStepStatus = z.infer<typeof OnboardingStepStatusSchema>;
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type UpdateUserProfile = z.infer<typeof UpdateUserProfileSchema>;
