import { z } from "zod";
import { AGENT_MODEL_CATALOG, CatalogModelIdSchema } from "./models";

export const OnboardingStepSchema = z.enum(["intro", "name", "tools", "basics", "plan"]);
const OnboardingStepStatusSchema = z.enum(["done", "skipped"]);

const OnboardingStateSchema = z.strictObject({
  steps: z.partialRecord(OnboardingStepSchema, OnboardingStepStatusSchema).default({}),
});

// Cap at one fewer than the catalog so at least one model always stays enabled. Derived
// from the catalog length so it cannot drift as the catalog grows.
const DisabledModelsSchema = z.array(CatalogModelIdSchema).max(AGENT_MODEL_CATALOG.length - 1);

export const UserProfileSchema = z.strictObject({
  agentDisplayName: z.string().min(1).max(80).nullable(),
  disabledModels: DisabledModelsSchema,
  globalMemory: z.string().max(8_000).nullable(),
  onboardingCompletedAt: z.string().datetime().nullable(),
  onboardingState: OnboardingStateSchema,
  updatedAt: z.string().datetime().nullable(),
});

export const UpdateUserProfileSchema = z
  .strictObject({
    agentDisplayName: z.string().trim().min(1).max(80).nullable().optional(),
    disabledModels: DisabledModelsSchema.optional(),
    globalMemory: z.string().max(8_000).nullable().optional(),
    onboardingCompleted: z.literal(true).optional(),
    onboardingStep: z
      .strictObject({ status: OnboardingStepStatusSchema, step: OnboardingStepSchema })

      .optional(),
  })

  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field is required.",
  });

export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;
export type OnboardingStepStatus = z.infer<typeof OnboardingStepStatusSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type UpdateUserProfile = z.infer<typeof UpdateUserProfileSchema>;
