import { z } from "zod";

export const SkillRuntimeScopeSchema = z.enum([
  "events:write",
  "integrations:execute",
  "skills:read",
  "skills:write",
]);

export type SkillRuntimeScope = z.infer<typeof SkillRuntimeScopeSchema>;
