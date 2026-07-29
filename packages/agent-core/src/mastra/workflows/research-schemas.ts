import { z } from "zod/v4";

const ResearchSourceIdSchema = z.string().trim().min(1).max(4_096);

const ResearchSourceFields = {
  id: ResearchSourceIdSchema,
  title: z.string().optional(),
  url: z.string().url(),
};

export const ResearchSourceSchema = z.discriminatedUnion("provider", [
  z.strictObject({
    ...ResearchSourceFields,
    provider: z.literal("exa"),
    providerRequestId: z.string().trim().min(1).max(500),
    providerResultId: z.string().trim().min(1).max(500),
  }),
  z.strictObject({
    ...ResearchSourceFields,
    provider: z.literal("firecrawl"),
  }),
]);

const ResearchClaimSchema = z.strictObject({
  claim: z.string().trim().min(1),
  sourceIds: z.array(ResearchSourceIdSchema).min(1),
});

export const ResearchFindingSchema = z.strictObject({
  claims: z.array(ResearchClaimSchema),
  query: z.string(),
  summary: z.string(),
  sources: z.array(ResearchSourceSchema),
});

export const ResearchReportSchema = z.strictObject({
  claims: z.array(ResearchClaimSchema),
  findings: z.array(ResearchFindingSchema),
  report: z.string(),
  sources: z.array(ResearchSourceSchema),
});

export const ResearchQuerySchema = z.strictObject({
  query: z.string().trim().min(1).max(1_000),
});

export const DeepResearchInputSchema = z.strictObject({
  maxQueries: z.number().int().min(3).max(12).default(6),
  topic: z.string().trim().min(1).max(2_000),
});

export const DeepResearchFanoutInputSchema = z.strictObject({
  entities: z.array(z.string().trim().min(1).max(200)).min(1).max(12).optional(),
  goal: z.string().trim().min(1).max(2_000),
  maxQueries: z.number().int().min(1).max(12).default(10),
});

export const ResearchQueryListSchema = z.array(ResearchQuerySchema).min(1).max(12);

export type ResearchClaim = z.infer<typeof ResearchClaimSchema>;
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;
