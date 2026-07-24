import { EnvironmentVariablesSchema } from "@cheatcode/sandbox-contracts";
import { WorkspaceFilePathSchema, WorkspacePathSchema } from "@cheatcode/tools-code";
import { PROJECT_FILE_MAX_BYTES, ProjectFileRelativePathSchema, ProjectId } from "@cheatcode/types";
import { z } from "zod";

const CommandArgvSchema = z.array(z.string().min(1).max(8_192)).min(1).max(128);
const ProcessIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "Process IDs may contain letters, numbers, . _ : -.");

export const ProjectWorkspaceSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    "Workspace slugs may contain lowercase letters, numbers, and single hyphens.",
  );

export const ProjectRunCodeInputSchema = z
  .object({
    language: z.enum(["python", "javascript"]),
    code: z.string().min(1).max(100_000),
    cwd: WorkspacePathSchema.optional(),
    env: EnvironmentVariablesSchema.optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
  })
  .strict();

export type ProjectRunCodeInput = z.infer<typeof ProjectRunCodeInputSchema>;

export const ProjectExecInputSchema = z
  .object({
    command: CommandArgvSchema,
    cwd: WorkspacePathSchema.optional(),
    env: EnvironmentVariablesSchema.optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
  })
  .strict();

export const ProjectStartProcessInputSchema = ProjectExecInputSchema.extend({
  stdin: z.string().min(1).max(64_000).optional(),
  isMobile: z.boolean().optional(),
  keepAliveTimeoutMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000)
    .optional(),
  maxRestarts: z.number().int().min(0).max(25).optional(),
  processId: ProcessIdSchema,
  restartOnFailure: z.boolean().optional(),
  waitForPort: z
    .object({
      port: z.number().int().positive().max(65_535),
      path: z.string().min(1).max(500).optional(),
      timeoutMs: z.number().int().positive().max(600_000).optional(),
    })
    .strict()
    .optional(),
}).strict();

export const ProjectReadFileInputSchema = z
  .object({
    path: WorkspaceFilePathSchema,
    encoding: z.enum(["utf8", "base64"]).optional(),
  })
  .strict();

export const ProjectPreviewFileInputSchema = z
  .object({
    path: WorkspaceFilePathSchema,
  })
  .strict();

export const ProjectWriteFileInputSchema = z
  .object({
    path: WorkspaceFilePathSchema,
    content: z.string().max(2_000_000),
    encoding: z.enum(["utf8", "base64"]).default("utf8"),
  })
  .strict();

export const ProjectUploadFileInputSchema = z
  .object({
    bytes: z
      .instanceof(Uint8Array)
      .refine(
        (value) => value.byteLength > 0 && value.byteLength <= PROJECT_FILE_MAX_BYTES,
        `Project files must be between 1 byte and ${PROJECT_FILE_MAX_BYTES} bytes.`,
      ),
    contentType: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    path: ProjectFileRelativePathSchema,
    projectId: z.string().uuid().toLowerCase().transform(ProjectId),
    workspaceSlug: ProjectWorkspaceSlugSchema,
  })
  .strict()
  .refine(
    (input) => input.workspaceSlug.endsWith(`-${input.projectId.toLowerCase()}`),
    "Workspace slug does not belong to the requested project.",
  );

export const ProjectListUploadedFilesInputSchema = z
  .object({
    projectId: z.string().uuid().toLowerCase().transform(ProjectId),
  })
  .strict();

export const ProjectListFilesInputSchema = z
  .object({
    path: WorkspacePathSchema,
    includeHidden: z.boolean().default(false),
    recursive: z.boolean().default(false),
  })
  .strict();

export const ProjectSearchFilesInputSchema = z
  .object({
    caseSensitive: z.boolean().default(false),
    contextLines: z.number().int().min(0).max(10).default(0),
    excludeDirs: z.array(z.string().min(1).max(200)).max(25).default([]),
    filePattern: z.string().min(1).max(200).optional(),
    maxResults: z.number().int().positive().max(1_000).default(100),
    path: WorkspacePathSchema,
    query: z.string().min(1).max(500),
  })
  .strict();

export const ProjectDeleteFileInputSchema = z
  .object({
    path: WorkspaceFilePathSchema,
    recursive: z.boolean().default(false),
  })
  .strict();

export const ProjectKillProcessInputSchema = z
  .object({
    processId: ProcessIdSchema,
  })
  .strict();

export const ProjectReadDevServerLogsInputSchema = z
  .object({
    lastPid: z.string().min(1).max(100).optional(),
    processId: ProcessIdSchema.default("app-preview"),
    stderrCursor: z.number().int().min(0).default(0),
    stdoutCursor: z.number().int().min(0).default(0),
    tail: z.number().int().min(1).max(500).default(200),
  })
  .strict();
export type ProjectReadDevServerLogsInput = z.input<typeof ProjectReadDevServerLogsInputSchema>;

export const ProjectAllocatePortInputSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    stack: z.enum(["web", "mobile"]),
  })
  .strict();

export const ProjectGetPortInputSchema = z
  .object({
    projectId: ProjectWorkspaceSlugSchema,
  })
  .strict();

export const ProjectAllocateProcessPortInputSchema = z
  .object({
    maxPort: z.number().int().min(1_024).max(65_535),
    minPort: z.number().int().min(1_024).max(65_535),
    processId: ProcessIdSchema,
  })
  .strict()
  .refine((input) => input.minPort <= input.maxPort, "Process port range is invalid.");

export const ProjectCodeServerInputSchema = z
  .object({
    initialFilePath: WorkspaceFilePathSchema.optional(),
    workspacePath: WorkspacePathSchema.default("/workspace"),
  })
  .strict();

export const ProjectWakePreviewInputSchema = z
  .object({
    // Which project's dev server to wake — its ProcessRecord slot is keyed by the project's
    // workspaceSlug (matching the start_dev_server tool + app-builder paths). Absent for a
    // project-less chat, where there is no dev server to revive.
    workspaceSlug: ProjectWorkspaceSlugSchema.optional(),
  })
  .strict();

// Read-only preview liveness for the status panel. Names which project's dev server to check —
// its ProcessRecord slot is keyed by workspaceSlug (matching start_dev_server + wakePreview).
// Always provided: only a project chat calls this, and every project owns a workspace slug.
export const ProjectPreviewStatusInputSchema = z
  .object({
    workspaceSlug: ProjectWorkspaceSlugSchema,
  })
  .strict();

export const ProjectSignedPreviewUrlInputSchema = z
  .object({
    port: z.number().int().positive().max(65_535),
    expiresInSeconds: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60),
  })
  .strict();

export const ProjectBrowserTakeoverInputSchema = z
  .object({
    expiresInSeconds: z
      .number()
      .int()
      .min(60)
      .max(10 * 60),
    runId: z.string().uuid(),
    takeoverId: z.string().uuid(),
  })
  .strict();

export const ProjectBrowserTakeoverStopInputSchema = z
  .object({ runId: z.string().uuid() })
  .strict();

// Per-project teardown inside the shared per-user sandbox: names ONE project's workspace folder
// (/workspace/<workspaceSlug>) whose dev server, port, and folder should be reclaimed — without
// ever touching the shared sandbox itself.
export const ProjectCleanupWorkspaceInputSchema = z
  .object({
    projectId: z.string().uuid().toLowerCase().transform(ProjectId),
    workspaceSlug: ProjectWorkspaceSlugSchema,
  })
  .strict()
  .refine(
    (input) => input.workspaceSlug.endsWith(`-${input.projectId.toLowerCase()}`),
    "Workspace slug does not belong to the requested project.",
  );

export const ProjectArchiveInputSchema = z
  .object({
    workspaceSlug: ProjectWorkspaceSlugSchema,
  })
  .strict();

export type ProjectExecInput = z.input<typeof ProjectExecInputSchema>;
export type ProjectStartProcessInput = z.input<typeof ProjectStartProcessInputSchema>;
export type ProjectPreviewFileInput = z.input<typeof ProjectPreviewFileInputSchema>;
export type ProjectReadFileInput = z.input<typeof ProjectReadFileInputSchema>;
export type ProjectWriteFileInput = z.input<typeof ProjectWriteFileInputSchema>;
export type ProjectUploadFileInput = z.input<typeof ProjectUploadFileInputSchema>;
export type ProjectListUploadedFilesInput = z.input<typeof ProjectListUploadedFilesInputSchema>;
export type ProjectListFilesInput = z.input<typeof ProjectListFilesInputSchema>;
export type ProjectSearchFilesInput = z.input<typeof ProjectSearchFilesInputSchema>;
export type ProjectDeleteFileInput = z.input<typeof ProjectDeleteFileInputSchema>;
export type ProjectKillProcessInput = z.input<typeof ProjectKillProcessInputSchema>;
export type ProjectAllocatePortInput = z.input<typeof ProjectAllocatePortInputSchema>;
export type ProjectGetPortInput = z.input<typeof ProjectGetPortInputSchema>;
export type ProjectAllocateProcessPortInput = z.input<typeof ProjectAllocateProcessPortInputSchema>;
export type ProjectCodeServerInput = z.input<typeof ProjectCodeServerInputSchema>;
export type ProjectWakePreviewInput = z.input<typeof ProjectWakePreviewInputSchema>;
export type ProjectPreviewStatusInput = z.input<typeof ProjectPreviewStatusInputSchema>;
export type ProjectSignedPreviewUrlInput = z.input<typeof ProjectSignedPreviewUrlInputSchema>;
export type ProjectBrowserTakeoverInput = z.input<typeof ProjectBrowserTakeoverInputSchema>;
export type ProjectBrowserTakeoverStopInput = z.input<typeof ProjectBrowserTakeoverStopInputSchema>;
export interface ProjectBrowserTakeoverResult {
  expiresAt: string;
  takeoverId: string;
  url: string;
}
export type ProjectArchiveInput = z.input<typeof ProjectArchiveInputSchema>;

/** Result of waking a preview: the (possibly restarted) dev-server preview URL + liveness. */
export interface ProjectWakePreviewResult {
  running: boolean;
  state: string;
  port?: number;
  url?: string;
  expiresAt?: string;
  // exp(s):// deep link for the Expo Go QR — only present for a mobile (Metro/8081) dev server,
  // regenerated from a fresh signed preview URL on every wake.
  expoUrl?: string;
}

/** Current Daytona lifecycle state for the project's sandbox (webhook/status surface). */
export interface ProjectSandboxRuntimeState {
  state: string;
  sandboxId?: string;
}
export type ProjectCleanupWorkspaceInput = z.input<typeof ProjectCleanupWorkspaceInputSchema>;
export type ParsedProjectCleanupWorkspaceInput = z.output<
  typeof ProjectCleanupWorkspaceInputSchema
>;

/** Returns the immutable project folder segment for a canonical /workspace path. */
export function workspaceSlugFromPath(path: string | undefined): string | null {
  if (!path) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments[0] !== "workspace" || segments.length < 2) {
    return null;
  }
  const parsed = ProjectWorkspaceSlugSchema.safeParse(segments[1]);
  return parsed.success ? parsed.data : null;
}

function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

export function commandToShellString(command: string[]): string {
  return command.map(shellQuote).join(" ");
}
