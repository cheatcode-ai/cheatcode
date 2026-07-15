import { z } from "zod/v4";

const ResearchSourceSchema = z
  .object({
    title: z.string().optional(),
    url: z.string().url(),
  })
  .strict();

export const ResearchFindingSchema = z
  .object({
    findings: z.string(),
    query: z.string(),
    sources: z.array(ResearchSourceSchema),
  })
  .strict();

export const ResearchReportSchema = z
  .object({
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
    entities: z.array(z.string().trim().min(1).max(200)).min(1).max(25).optional(),
    goal: z.string().trim().min(1).max(2_000),
    maxQueries: z.number().int().min(1).max(25).default(10),
  })
  .strict();

export const ResearchQueryListSchema = z.array(ResearchQuerySchema).min(1).max(25);

export type ResearchFinding = z.infer<typeof ResearchFindingSchema>;
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;
