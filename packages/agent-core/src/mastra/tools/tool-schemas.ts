import { EnvironmentVariablesSchema } from "@cheatcode/sandbox-contracts";
import { SKILLS } from "@cheatcode/skills";
import { WorkspacePathSchema } from "@cheatcode/tools-code";
import { z } from "zod/v4";
import { ResearchReportSchema } from "../workflows";

export const startDevServerInputSchema = z
  .object({
    command: z
      .array(z.string().min(1).describe("One argv element."))
      .min(1)
      .max(128)
      .describe("Dev server command argv."),
    cwd: WorkspacePathSchema.describe("App directory under /workspace."),
    env: EnvironmentVariablesSchema.optional().describe("Request-scoped env vars."),
    name: z.string().min(1).max(100).default("app-preview").describe("Preview name."),
    port: z
      .number()
      .int()
      .positive()
      .max(65_535)
      .default(5173)
      .describe("HTTP port to expose. Use 5173 for frontend previews."),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(600_000)
      .default(120_000)
      .describe("Maximum startup wait in milliseconds."),
  })
  .strict();

export const startDevServerOutputSchema = z
  .object({
    processId: z.string(),
    pid: z.number().int().positive().optional(),
    port: z.number().int().positive(),
    status: z.string(),
  })
  .strict();

const skillNames = SKILLS.map((skill) => skill.name);
if (skillNames.length === 0) {
  throw new Error("At least one bundled skill is required.");
}

const skillNameSchema = z.enum(skillNames as [string, ...string[]]);

const skillBundledFileSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine((value) => !value.includes(".."), "Bundled skill file names cannot traverse paths.");

/** Loose skill name — accepts both bundled (enum) names and the user's custom skill names. */
const invokeSkillNameSchema = z.string().trim().min(1).max(80);

export const skillInvokeInputSchema = z
  .object({
    skillName: invokeSkillNameSchema.describe("Name of the bundled or custom skill to load."),
  })
  .strict();

export const skillCreateInputSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1)
      .max(40_000)
      .describe("Full markdown instructions for the skill (the operating procedure)."),
    category: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe('One of "Builder & Apps", "Research & Docs", "Data & Media".'),
    description: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .describe("One line: what the skill does and when to use it."),
    name: z.string().trim().min(1).max(80).describe("Short skill name."),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  })
  .strict();

export const skillCreateOutputSchema = z
  .object({
    name: z.string(),
    saved: z.boolean(),
  })
  .strict();

export const skillInvokeOutputSchema = z
  .object({
    assets: z.array(z.string()),
    compatibility: z.string().optional(),
    description: z.string(),
    instructions: z.string(),
    license: z.string().optional(),
    name: z.string(),
    references: z.array(z.string()),
  })
  .strict();

export const skillReadReferenceInputSchema = z
  .object({
    filename: skillBundledFileSchema.describe("Reference filename bundled with the skill."),
    skillName: skillNameSchema.describe("Name of the active skill."),
  })
  .strict();

export const skillReadReferenceOutputSchema = z
  .object({
    content: z.string().nullable(),
    filename: z.string(),
    skillName: z.string(),
  })
  .strict();

export const workflowResultSchema = z
  .object({
    error: z.unknown().optional(),
    result: ResearchReportSchema.optional(),
    status: z.string(),
  })
  .passthrough();
