import { WorkspaceFilePathSchema, WorkspacePathSchema } from "@cheatcode/agent-core/tools/code";
import { EnvironmentVariablesSchema } from "@cheatcode/sandbox-contracts";
import { toProjectId } from "@cheatcode/types";
import {
  PROJECT_FILE_MAX_BYTES,
  ProjectDeliverableFilenameSchema,
  ProjectFileRelativePathSchema,
} from "@cheatcode/types/api";
import { GENERATED_OUTPUT_MAX_BYTES, OutputIdSchema } from "@cheatcode/types/artifacts";
import { z } from "zod";
import { shellQuote } from "../sandbox-support";

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

export const ProjectRunCodeInputSchema = z.strictObject({
  language: z.enum(["python", "javascript"]),
  code: z.string().min(1).max(100_000),
  cwd: WorkspacePathSchema.optional(),
  env: EnvironmentVariablesSchema.optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});

export type ProjectRunCodeInput = z.infer<typeof ProjectRunCodeInputSchema>;

export const ProjectExecInputSchema = z.strictObject({
  command: CommandArgvSchema,
  cwd: WorkspacePathSchema.optional(),
  env: EnvironmentVariablesSchema.optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});

export const ProjectStartProcessInputSchema = z.strictObject({
  ...ProjectExecInputSchema.shape,
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
    .strictObject({
      port: z.number().int().positive().max(65_535),
      path: z.string().min(1).max(500).optional(),
      timeoutMs: z.number().int().positive().max(600_000).optional(),
    })

    .optional(),
});

export const ProjectReadFileInputSchema = z.strictObject({
  path: WorkspaceFilePathSchema,
  encoding: z.enum(["utf8", "base64"]).optional(),
});

export const ProjectWriteFileInputSchema = z.strictObject({
  path: WorkspaceFilePathSchema,
  content: z.string().max(2_000_000),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
});

export const ProjectUploadFileInputSchema = z
  .strictObject({
    bytes: z
      .instanceof(Uint8Array)
      .refine(
        (value) => value.byteLength > 0 && value.byteLength <= PROJECT_FILE_MAX_BYTES,
        `Project files must be between 1 byte and ${PROJECT_FILE_MAX_BYTES} bytes.`,
      ),
    contentType: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    path: ProjectFileRelativePathSchema,
    projectId: z.string().uuid().toLowerCase().transform(toProjectId),
    workspaceSlug: ProjectWorkspaceSlugSchema,
  })

  .refine(
    (input) => input.workspaceSlug.endsWith(`-${input.projectId.toLowerCase()}`),
    "Workspace slug does not belong to the requested project.",
  );

export const ProjectListUploadedFilesInputSchema = z.strictObject({
  projectId: z.string().uuid().toLowerCase().transform(toProjectId),
});

export const ProjectRestoreUploadedFilesInputSchema = z
  .strictObject({
    projectId: z.string().uuid().toLowerCase().transform(toProjectId),
    workspaceSlug: ProjectWorkspaceSlugSchema,
  })

  .refine(
    (input) => input.workspaceSlug.endsWith(`-${input.projectId.toLowerCase()}`),
    "Workspace slug does not belong to the requested project.",
  );

export const ProjectRestoreGeneratedOutputInputSchema = z
  .strictObject({
    bytes: z
      .instanceof(Uint8Array)
      .refine(
        (value) => value.byteLength > 0 && value.byteLength <= GENERATED_OUTPUT_MAX_BYTES,
        `Generated outputs must be between 1 byte and ${GENERATED_OUTPUT_MAX_BYTES} bytes.`,
      ),
    filename: ProjectDeliverableFilenameSchema,
    outputId: OutputIdSchema,
    projectId: z.string().uuid().toLowerCase().transform(toProjectId),
    workspaceSlug: ProjectWorkspaceSlugSchema,
  })
  .refine(
    (input) => input.workspaceSlug.endsWith(`-${input.projectId.toLowerCase()}`),
    "Workspace slug does not belong to the requested project.",
  );

export const ProjectListFilesInputSchema = z.strictObject({
  path: WorkspacePathSchema,
  includeHidden: z.boolean().default(false),
  recursive: z.boolean().default(false),
});

export const ProjectSearchFilesInputSchema = z.strictObject({
  caseSensitive: z.boolean().default(false),
  contextLines: z.number().int().min(0).max(10).default(0),
  excludeDirs: z.array(z.string().min(1).max(200)).max(25).default([]),
  filePattern: z.string().min(1).max(200).optional(),
  maxResults: z.number().int().positive().max(1_000).default(100),
  path: WorkspacePathSchema,
  query: z.string().min(1).max(500),
});

export const ProjectDeleteFileInputSchema = z.strictObject({
  path: WorkspaceFilePathSchema,
  recursive: z.boolean().default(false),
});

export const ProjectKillProcessInputSchema = z.strictObject({
  processId: ProcessIdSchema,
});

export const ProjectReadDevServerLogsInputSchema = z.strictObject({
  lastPid: z.string().min(1).max(100).optional(),
  processId: ProcessIdSchema.default("app-preview"),
  stderrCursor: z.number().int().min(0).default(0),
  stdoutCursor: z.number().int().min(0).default(0),
  tail: z.number().int().min(1).max(500).default(200),
});
export type ProjectReadDevServerLogsInput = z.input<typeof ProjectReadDevServerLogsInputSchema>;

export const ProjectAllocatePortInputSchema = z.strictObject({
  projectId: z.string().min(1).max(200),
  stack: z.enum(["web", "mobile"]),
});

export const ProjectAllocateProcessPortInputSchema = z
  .strictObject({
    maxPort: z.number().int().min(1_024).max(65_535),
    minPort: z.number().int().min(1_024).max(65_535),
    processId: ProcessIdSchema,
  })

  .refine((input) => input.minPort <= input.maxPort, "Process port range is invalid.");

export const ProjectCodeServerInputSchema = z.strictObject({
  initialFilePath: WorkspaceFilePathSchema.optional(),
  workspacePath: WorkspacePathSchema.default("/workspace"),
});

export const ProjectWakePreviewInputSchema = z.strictObject({
  // Which project's dev server to wake — its ProcessRecord slot is keyed by the project's
  // workspaceSlug (matching the code_start_dev_server tool + app-builder paths). Absent for a
  // project-less chat, where there is no dev server to revive.
  workspaceSlug: ProjectWorkspaceSlugSchema.optional(),
});

// Read-only preview liveness for the status panel. Names which project's dev server to check —
// its ProcessRecord slot is keyed by workspaceSlug (matching code_start_dev_server + wakePreview).
// Always provided: only a project chat calls this, and every project owns a workspace slug.
export const ProjectPreviewStatusInputSchema = z.strictObject({
  workspaceSlug: ProjectWorkspaceSlugSchema,
});

export const ProjectSignedPreviewUrlInputSchema = z.strictObject({
  port: z.number().int().positive().max(65_535),
  expiresInSeconds: z
    .number()
    .int()
    .positive()
    .max(24 * 60 * 60),
});

export const ProjectBrowserTakeoverInputSchema = z.strictObject({
  expiresInSeconds: z
    .number()
    .int()
    .min(60)
    .max(10 * 60),
  runId: z.string().uuid(),
  takeoverId: z.string().uuid(),
});

export const ProjectBrowserTakeoverStopInputSchema = z.strictObject({ runId: z.string().uuid() });

// Per-project teardown inside the shared per-user sandbox: names ONE project's workspace folder
// (/workspace/<workspaceSlug>) whose dev server, port, and folder should be reclaimed — without
// ever touching the shared sandbox itself.
export const ProjectCleanupWorkspaceInputSchema = z
  .strictObject({
    projectId: z.string().uuid().toLowerCase().transform(toProjectId),
    workspaceSlug: ProjectWorkspaceSlugSchema,
  })

  .refine(
    (input) => input.workspaceSlug.endsWith(`-${input.projectId.toLowerCase()}`),
    "Workspace slug does not belong to the requested project.",
  );

export const ProjectArchiveInputSchema = z.strictObject({
  workspaceSlug: ProjectWorkspaceSlugSchema,
});

export type ProjectExecInput = z.input<typeof ProjectExecInputSchema>;
export type ProjectStartProcessInput = z.input<typeof ProjectStartProcessInputSchema>;
export type ProjectReadFileInput = z.input<typeof ProjectReadFileInputSchema>;
export type ProjectWriteFileInput = z.input<typeof ProjectWriteFileInputSchema>;
export type ProjectUploadFileInput = z.input<typeof ProjectUploadFileInputSchema>;
export type ProjectListUploadedFilesInput = z.input<typeof ProjectListUploadedFilesInputSchema>;
export type ProjectRestoreUploadedFilesInput = z.input<
  typeof ProjectRestoreUploadedFilesInputSchema
>;
export type ProjectRestoreGeneratedOutputInput = z.input<
  typeof ProjectRestoreGeneratedOutputInputSchema
>;
export type ProjectListFilesInput = z.input<typeof ProjectListFilesInputSchema>;
export type ProjectSearchFilesInput = z.input<typeof ProjectSearchFilesInputSchema>;
export type ProjectDeleteFileInput = z.input<typeof ProjectDeleteFileInputSchema>;
export type ProjectKillProcessInput = z.input<typeof ProjectKillProcessInputSchema>;
export type ProjectAllocatePortInput = z.input<typeof ProjectAllocatePortInputSchema>;
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

export function commandToShellString(command: string[]): string {
  return command.map(shellQuote).join(" ");
}
