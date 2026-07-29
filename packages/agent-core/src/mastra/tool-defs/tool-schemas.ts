import { EnvironmentVariablesSchema } from "@cheatcode/sandbox-contracts";
import { SKILLS } from "@cheatcode/skills";
import { z } from "zod/v4";
import { WorkspacePathSchema } from "../../tools/code";
import { ResearchReportSchema } from "../workflows";

export const StartDevServerInputSchema = z.strictObject({
  command: z
    .array(z.string().min(1).max(8_192).describe("One argv element."))
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
});

export const StartDevServerOutputSchema = z.strictObject({
  processId: z.string(),
  pid: z.number().int().positive().optional(),
  port: z.number().int().positive(),
  status: z.string(),
});

const skillNames = SKILLS.map((skill) => skill.name);
if (skillNames.length === 0) {
  throw new Error("At least one bundled skill is required.");
}

const SkillNameSchema = z.enum(skillNames as [string, ...string[]]);

const SkillBundledFileSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine((value) => !value.includes(".."), "Bundled skill file names cannot traverse paths.");

/** Loose skill name — accepts both bundled (enum) names and the user's custom skill names. */
const InvokeSkillNameSchema = z.string().trim().min(1).max(80);

export const SkillInvokeInputSchema = z.strictObject({
  skillName: InvokeSkillNameSchema.describe("Name of the bundled or custom skill to load."),
});

export const SkillCreateInputSchema = z.strictObject({
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
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    .describe("Exact folder name authored under /workspace/.cheatcode/skills/."),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

export const SkillCreateOutputSchema = z.strictObject({
  created: z.literal(true),
  description: z.string(),
  filePath: z.string(),
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

export const SkillInvokeOutputSchema = z.strictObject({
  assets: z.array(z.string()),
  compatibility: z.string().optional(),
  description: z.string(),
  instructions: z.string(),
  license: z.string().optional(),
  name: z.string(),
  references: z.array(z.string()),
  rootPath: z
    .string()
    .min(1)
    .describe(
      "Filesystem root of the complete skill package. Resolve instructions that mention scripts/, references/, or assets/ from this directory.",
    ),
});

export const SkillReadReferenceInputSchema = z.strictObject({
  filename: SkillBundledFileSchema.describe("Reference filename bundled with the skill."),
  skillName: SkillNameSchema.describe("Name of the active skill."),
});

export const SkillReadReferenceOutputSchema = z.strictObject({
  content: z.string().nullable(),
  filename: z.string(),
  skillName: z.string(),
});

export const WorkflowResultSchema = z.looseObject({
  error: z.unknown().optional(),
  result: ResearchReportSchema.optional(),
  status: z.string(),
});
