import { SKILLS } from "@cheatcode/skills";
import { z } from "zod/v4";
import { ResearchReportSchema } from "../workflows";

const workspacePathSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine((path) => path.startsWith("/"), "Sandbox paths must be absolute.")
  .refine(isSafeWorkspacePath, "Path must stay inside /workspace.");

const workspaceFilePathSchema = workspacePathSchema.refine(
  isWorkspaceChildPath,
  "File path must be inside /workspace.",
);

const workspaceRelativePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(isSafeWorkspaceRelativePath, "Relative paths must stay inside /workspace.");

export const runCodeInputSchema = z
  .object({
    language: z
      .enum(["python", "javascript"])
      .describe("Language to execute inside the project sandbox."),
    code: z.string().min(1).max(100_000).describe("Source code to execute."),
  })
  .strict();

export const runCodeOutputSchema = z
  .object({
    stdout: z.string(),
    stderr: z.string(),
    success: z.boolean(),
    exitCode: z.number().int().nullable(),
  })
  .strict();

export const shellOutputSchema = z
  .object({
    command: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    success: z.boolean(),
    exitCode: z.number().int(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .strict();

export const shellExecInputSchema = z
  .object({
    command: z
      .array(z.string().min(1).describe("One argv element. Do not pass a shell-joined string."))
      .min(1)
      .max(128)
      .describe("Command argv to run inside the sandbox."),
    cwd: z
      .string()
      .min(1)
      .max(1_000)
      .refine((path) => path.startsWith("/"), "Sandbox paths must be absolute.")
      .refine(isSafeWorkspacePath, "Path must stay inside /workspace.")
      .optional()
      .describe("Absolute working directory under /workspace."),
    env: z
      .record(z.string(), z.string())
      .optional()
      .describe("Request-scoped environment variables for this command only."),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(600_000)
      .optional()
      .describe("Maximum command runtime in milliseconds."),
  })
  .strict();

const encodingSchema = z.enum(["utf8", "base64"]);

export const readFileInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(1_000)
      .refine((path) => path.startsWith("/"), "Sandbox paths must be absolute.")
      .refine(isSafeWorkspacePath, "Path must stay inside /workspace.")
      .refine(isWorkspaceChildPath, "File path must be inside /workspace.")
      .describe("Absolute file path under /workspace, for example /workspace/app/package.json."),
    encoding: encodingSchema.optional().describe("Read text as utf8 or binary data as base64."),
  })
  .strict();

export const readFileOutputSchema = z
  .object({
    path: z.string(),
    content: z.string(),
    encoding: encodingSchema,
    size: z.number().int().nonnegative().optional(),
  })
  .strict();

export const writeFileInputSchema = z
  .object({
    path: workspaceFilePathSchema.describe("Absolute file path under /workspace."),
    content: z.string().max(2_000_000).describe("File contents to write."),
    encoding: encodingSchema.default("utf8").describe("Write text as utf8 or binary as base64."),
  })
  .strict();

export const writeFileOutputSchema = z
  .object({
    path: z.string(),
    success: z.boolean(),
  })
  .strict();

const fileEntrySchema = z
  .object({
    name: z.string(),
    path: z.string(),
    relativePath: z.string(),
    type: z.enum(["file", "directory", "symlink", "other"]),
    size: z.number().int().nonnegative(),
    modifiedAt: z.string(),
  })
  .strict();

export const listFilesInputSchema = z
  .object({
    path: workspacePathSchema.describe("Absolute directory path under /workspace."),
    includeHidden: z
      .boolean()
      .default(false)
      .describe("Include dotfiles and dot-directories when true."),
    recursive: z.boolean().default(false).describe("List descendants recursively when true."),
  })
  .strict();

export const listFilesOutputSchema = z
  .object({
    path: z.string(),
    files: z.array(fileEntrySchema),
  })
  .strict();

export const gitStatusInputSchema = z
  .object({
    cwd: workspacePathSchema.default("/workspace").describe("Repository under /workspace."),
  })
  .strict();

export const gitCloneInputSchema = z
  .object({
    repoUrl: z.string().url().describe("Git repository URL to clone."),
    targetDir: workspaceRelativePathSchema.describe("Relative directory name under /workspace."),
    branch: z.string().min(1).max(200).optional().describe("Optional branch or tag to clone."),
    depth: z.number().int().positive().max(1000).default(1).describe("Clone depth."),
  })
  .strict();

export const gitCommitInputSchema = z
  .object({
    cwd: workspacePathSchema.describe("Repository directory under /workspace."),
    message: z.string().min(1).max(500).describe("Commit message."),
  })
  .strict();

export const gitPushInputSchema = z
  .object({
    cwd: workspacePathSchema.describe("Repository directory under /workspace."),
    remote: z.string().min(1).max(100).default("origin").describe("Remote name."),
    branch: z.string().min(1).max(200).optional().describe("Branch ref to push."),
  })
  .strict();

export const startDevServerInputSchema = z
  .object({
    command: z
      .array(z.string().min(1).describe("One argv element."))
      .min(1)
      .max(128)
      .describe("Dev server command argv."),
    cwd: workspacePathSchema.describe("App directory under /workspace."),
    env: z.record(z.string(), z.string()).optional().describe("Request-scoped env vars."),
    hostname: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe("Preview hostname override; omit to use the active environment."),
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
    previewUrl: z.string().url(),
    port: z.number().int().positive(),
    status: z.string(),
  })
  .strict();

export const snapshotHandleSchema = z
  .object({
    id: z.string().min(1),
    dir: workspacePathSchema,
  })
  .strict();

export const createSnapshotInputSchema = z
  .object({
    dir: z
      .string()
      .min(1)
      .max(1_000)
      .refine((path) => path.startsWith("/"), "Sandbox paths must be absolute.")
      .refine(isSafeWorkspacePath, "Path must stay inside /workspace.")
      .default("/workspace")
      .describe("Workspace directory represented by the persistent volume handle."),
    name: z.string().min(1).max(200).optional().describe("Human-readable handle label."),
    ttl: z
      .number()
      .int()
      .positive()
      .max(90 * 24 * 60 * 60)
      .default(30 * 24 * 60 * 60)
      .describe(
        "Deprecated compatibility TTL in seconds; the Daytona sandbox disk owns durability.",
      ),
  })
  .strict();

export const restoreSnapshotInputSchema = z
  .object({
    backup: snapshotHandleSchema.describe("Volume handle returned by sandbox_snapshot."),
  })
  .strict();

export const restoreSnapshotOutputSchema = z
  .object({
    id: z.string(),
    dir: z.string(),
    success: z.boolean(),
  })
  .strict();

export const browserOpenInputSchema = z
  .object({
    url: z.string().url().describe("URL to open in the sandbox browser."),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkidle", "commit"])
      .default("domcontentloaded")
      .describe("Navigation wait strategy."),
  })
  .strict();

export const browserActInputSchema = z
  .object({
    instruction: z.string().min(1).max(2_000).describe("Natural-language browser action."),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(120_000)
      .default(10_000)
      .describe("Maximum time for this browser action."),
  })
  .strict();

export const browserObserveInputSchema = z
  .object({
    instruction: z.string().min(1).max(2_000).describe("What to observe on the current page."),
  })
  .strict();

export const browserExtractInputSchema = z
  .object({
    instruction: z
      .string()
      .min(1)
      .max(2_000)
      .describe("What information to extract from the current page."),
  })
  .strict();

export const browserScreenshotInputSchema = z
  .object({
    fullPage: z.boolean().default(false).describe("Capture the full page when true."),
  })
  .strict();

const browserActionResultSchema = z
  .object({
    base64: z.string().optional(),
    mediaType: z.string().optional(),
    result: z.unknown().optional(),
    type: z.string(),
    url: z.string().optional(),
  })
  .passthrough();

export const browserActionsOutputSchema = z
  .object({
    ok: z.boolean(),
    results: z.array(browserActionResultSchema),
  })
  .strict();

const skillNames = SKILLS.map((skill) => skill.name);
if (skillNames.length === 0) {
  throw new Error("At least one bundled skill is required.");
}

export const skillNameSchema = z.enum(skillNames as [string, ...string[]]);

export const skillBundledFileSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine((value) => !value.includes(".."), "Bundled skill file names cannot traverse paths.");

/** Loose skill name — accepts both bundled (enum) names and the user's custom skill names. */
export const invokeSkillNameSchema = z.string().trim().min(1).max(80);

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

function isSafeWorkspacePath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path);
  return normalized === "/workspace" || normalized.startsWith("/workspace/");
}

function isWorkspaceChildPath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path);
  return normalized.startsWith("/workspace/") && normalized !== "/workspace/";
}

function isSafeWorkspaceRelativePath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\0")) {
    return false;
  }
  const normalized = normalizeRelativePath(path);
  return normalized.length > 0 && normalized !== "." && !normalized.startsWith("../");
}

function normalizeWorkspacePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part.length === 0 || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}${path.endsWith("/") ? "/" : ""}`;
}

function normalizeRelativePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part.length === 0 || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length === 0) {
        return "../";
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}
