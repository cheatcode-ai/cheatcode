import { z } from "zod/v4";

const ResearchSourceIdSchema = z.string().trim().min(1).max(4_096);

const ResearchSourceFields = {
  id: ResearchSourceIdSchema,
  title: z.string().optional(),
  url: z.string().url(),
};

export const ResearchSourceSchema = z.discriminatedUnion("provider", [
  z
    .object({
      ...ResearchSourceFields,
      provider: z.literal("exa"),
      providerRequestId: z.string().trim().min(1).max(500),
      providerResultId: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      ...ResearchSourceFields,
      provider: z.literal("firecrawl"),
    })
    .strict(),
]);

const ResearchClaimSchema = z
  .object({
    claim: z.string().trim().min(1),
    sourceIds: z.array(ResearchSourceIdSchema).min(1),
  })
  .strict();

export const ResearchFindingSchema = z
  .object({
    claims: z.array(ResearchClaimSchema),
    query: z.string(),
    summary: z.string(),
    sources: z.array(ResearchSourceSchema),
  })
  .strict();

export const ResearchReportSchema = z
  .object({
    claims: z.array(ResearchClaimSchema),
    findings: z.array(ResearchFindingSchema),
    report: z.string(),
    sources: z.array(ResearchSourceSchema),
  })
  .strict();

export const ResearchQuerySchema = z
  .object({
    query: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const DeepResearchInputSchema = z
  .object({
    maxQueries: z.number().int().min(3).max(12).default(6),
    topic: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const DeepResearchFanoutInputSchema = z
  .object({
    entities: z.array(z.string().trim().min(1).max(200)).min(1).max(12).optional(),
    goal: z.string().trim().min(1).max(2_000),
    maxQueries: z.number().int().min(1).max(12).default(10),
  })
  .strict();

export const ResearchQueryListSchema = z.array(ResearchQuerySchema).min(1).max(12);

export type ResearchClaim = z.infer<typeof ResearchClaimSchema>;
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;
