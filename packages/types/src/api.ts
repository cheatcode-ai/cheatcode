import { z } from "zod";
import { OutputIdSchema } from "./artifacts";
import { IntegrationNameSchema } from "./integrations";
import { LogicalModelIdSchema } from "./models";
import { extendSandboxExecResultShape, sandboxFileEntryShape } from "./sandbox-wire";
import { MessagePartsSchema } from "./ui-message";

/** Canonical total character budget for one submitted user message, including inline attachments. */
export const USER_MESSAGE_MAX_CHARACTERS = 20_000;

const UserTextPartSchema = z.strictObject({
  text: z.string().trim().min(1).max(USER_MESSAGE_MAX_CHARACTERS),
  type: z.literal("text"),
});

/**
 * Public GitHub repo URL accepted for one-shot project import. The single regex
 * enforces https + an exact `github.com` host (no port, no `host.evil.com`
 * suffix), exactly one `{owner}/{repo}` path, and — by requiring `github.com`
 * immediately after the scheme — rejects any embedded `user:pass@` userinfo, so
 * private-repo credentials can never ride in the URL. Avoids the `URL` global,
 * which is absent from this package's `lib`/`types` set; the gateway and agent
 * worker re-validate at their own trust boundaries.
 */
export const GitHubRepoUrlSchema = z
  .string()
  .trim()
  .max(300)
  .regex(
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/,
    "Must be a public https://github.com/{owner}/{repo} URL",
  );

const PROJECT_MODES = ["app-builder", "app-builder-mobile", "general"] as const;
export const ProjectModeSchema = z.enum(PROJECT_MODES);

/** Product modes selected by UI intent or a high-confidence projectless build imperative. */
const RUN_INTENTS = ["skill-creator"] as const;
export const RunIntentSchema = z.enum(RUN_INTENTS);

export const CreateProjectSchema = z.strictObject({
  defaultModel: LogicalModelIdSchema.optional(),
  importRepoUrl: GitHubRepoUrlSchema.optional(),
  name: z.string().trim().min(1).max(120),
  mode: ProjectModeSchema.default("general"),
});

export const CreateThreadSchema = z.strictObject({
  defaultModel: LogicalModelIdSchema.optional(),
  initialPrompt: z.string().trim().min(1).max(20_000).optional(),
  importRepoUrl: GitHubRepoUrlSchema.optional(),
  mode: ProjectModeSchema.optional(),
  projectId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

export const UpdateThreadSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
});

export const ProjectSummarySchema = z.strictObject({
  archiveAfter: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  defaultModel: LogicalModelIdSchema.nullable(),
  id: z.string().uuid(),
  importRepoUrl: z.string().nullable(),
  mode: ProjectModeSchema,
  name: z.string(),
  overQuota: z.boolean(),
  readOnly: z.boolean(),
  updatedAt: z.string().datetime(),
});

export const UpdateProjectSchema = z
  .strictObject({
    defaultModel: LogicalModelIdSchema.nullable().optional(),
    importRepoUrl: GitHubRepoUrlSchema.nullable().optional(),
    name: z.string().trim().min(1).max(120).optional(),
  })

  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one project field is required.",
  });

export const ThreadSchema = z.strictObject({
  activeRunId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
  latestModelId: LogicalModelIdSchema.nullable(),
  pendingInitialPrompt: z.string().nullable(),
  projectId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export const ThreadMessageSchema = z.strictObject({
  agentRunId: z.string().uuid().nullable(),
  agentRunSegment: z.number().int().nonnegative(),
  agentRunSegmentFinal: z.boolean(),
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
  parts: MessagePartsSchema,
  role: z.enum(["assistant", "user"]),
  threadId: z.string().uuid(),
});

export const PaginationQuerySchema = z.strictObject({
  cursor: z.string().trim().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Exact maximum size of a finalized project-download ZIP across server and web clients. */
export const PROJECT_ARCHIVE_MAX_OUTPUT_BYTES = 640 * 1024 * 1024;

/** One project-file upload is bounded to keep Worker memory below its platform ceiling. */
export const PROJECT_FILE_MAX_BYTES = 20 * 1024 * 1024;
/** Browser clients upload sequentially and may select at most this many files per batch. */
export const PROJECT_FILE_MAX_BATCH = 10;
/** Operational namespace ceiling for current files in one project. */
export const PROJECT_FILE_MAX_CURRENT_FILES = 1_000;
/** Bounded recent generated-output catalog returned by the project file browser. */
export const PROJECT_DELIVERABLE_MAX_CURRENT_FILES = 1_000;

export const ProjectFileRelativePathSchema = z
  .string()
  .min(9)
  .max(240)
  .regex(
    /^uploads\/(?!\.{1,2}(?:\/|$))[^/\0]+$/u,
    "Project uploads must be a single canonical file under uploads/.",
  );

export const ProjectFileSchema = z.strictObject({
  contentType: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  fileId: z.string().uuid(),
  name: z.string().min(1).max(200),
  path: ProjectFileRelativePathSchema,
  projectId: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sizeBytes: z.number().int().positive().max(PROJECT_FILE_MAX_BYTES),
  updatedAt: z.string().datetime(),
  versionCount: z.number().int().positive(),
  versionId: z.string().uuid(),
});

export const ProjectUploadedFileListSchema = z.strictObject({
  files: z.array(ProjectFileSchema).max(PROJECT_FILE_MAX_CURRENT_FILES),
});

export const ProjectDeliverableFilenameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9._-]+$/u, "Generated deliverable filenames must be canonical.")
  .refine((value) => value !== "." && value !== "..", "Invalid deliverable filename.");

export const ProjectDeliverableRelativePathSchema = z
  .string()
  .min(51)
  .max(305)
  .regex(
    /^deliverables\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[a-z0-9._-]+$/u,
    "Generated deliverables must use their durable project path.",
  );

export function projectDeliverableRelativePath(outputId: string, filename: string): string {
  const parsedOutputId = OutputIdSchema.parse(outputId);
  const parsedFilename = ProjectDeliverableFilenameSchema.parse(filename);
  return ProjectDeliverableRelativePathSchema.parse(
    `deliverables/${parsedOutputId}/${parsedFilename}`,
  );
}

const ProjectDeliverableSchema = z
  .strictObject({
    contentType: z.string().min(1).max(255),
    name: ProjectDeliverableFilenameSchema,
    outputId: OutputIdSchema,
    path: ProjectDeliverableRelativePathSchema,
    projectId: z.string().uuid(),
    type: z.literal("deliverable"),
  })
  .refine(
    (value) => value.path === projectDeliverableRelativePath(value.outputId, value.name),
    "Generated deliverable path does not match its identity.",
  );

const ProjectUploadedFileReferenceSchema = z.strictObject({
  ...ProjectFileSchema.shape,
  type: z.literal("upload"),
});

const ProjectFileReferenceSchema = z.discriminatedUnion("type", [
  ProjectDeliverableSchema,
  ProjectUploadedFileReferenceSchema,
]);

export const ProjectFileListSchema = z.strictObject({
  files: z
    .array(ProjectFileReferenceSchema)
    .max(PROJECT_FILE_MAX_CURRENT_FILES + PROJECT_DELIVERABLE_MAX_CURRENT_FILES),
});

export const ProjectFileUploadResponseSchema = z.strictObject({
  file: ProjectFileSchema,
  status: z.enum(["created", "unchanged", "updated"]),
});

export const CreateRunSchema = z.strictObject({
  intent: RunIntentSchema.optional(),
  message: z.strictObject({
    id: z.string().uuid().optional(),
    role: z.enum(["user"]),
    parts: z.array(UserTextPartSchema).length(1),
  }),
  model: LogicalModelIdSchema.optional(),
});

export const ProviderSchema = z.enum([
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "deepseek",
  "exa",
  "firecrawl",
]);

export type Provider = z.infer<typeof ProviderSchema>;

export const ProviderKeySummarySchema = z.strictObject({
  disabledAt: z.string().datetime().nullable(),
  disabledReason: z.string().nullable(),
  provider: ProviderSchema,
});

export const ComposioConnectionIdSchema = z.string().trim().min(1).max(256);

const IntegrationStatusSchema = z.enum([
  "not_connected",
  "initiating",
  "active",
  "inactive",
  "expired",
  "failed",
]);

const IntegrationAccountSchema = z.strictObject({
  connectedAt: z.string().datetime(),
  connectionId: ComposioConnectionIdSchema,
  isDefault: z.boolean(),
  label: z.string(),
  status: IntegrationStatusSchema,
  updatedAt: z.string().datetime(),
});

export const IntegrationSchema = z.strictObject({
  accounts: z.array(IntegrationAccountSchema),
  displayName: z.string(),
  name: IntegrationNameSchema,
  status: IntegrationStatusSchema,
});

export const IntegrationConnectResponseSchema = z.strictObject({
  oauthUrl: z.string().url(),
});

const ToolkitCategorySchema = z.strictObject({
  name: z.string(),
  slug: z.string(),
});

const ToolkitCatalogEntrySchema = z.strictObject({
  accounts: z.array(IntegrationAccountSchema),
  categorySlugs: z.array(z.string()),
  connectable: z.boolean(),
  description: z.string(),
  displayName: z.string(),
  name: IntegrationNameSchema,
  status: IntegrationStatusSchema,
});

export const IntegrationCatalogSchema = z.strictObject({
  categories: z.array(ToolkitCategorySchema),
  toolkits: z.array(ToolkitCatalogEntrySchema),
});

const ToolkitActionSchema = z.strictObject({
  description: z.string(),
  name: z.string(),
  slug: z.string(),
});

export const ToolkitActionsResponseSchema = z.strictObject({
  actions: z.array(ToolkitActionSchema),
});

const ToolDomainSchema = z.enum([
  "browser",
  "code",
  "data",
  "docs",
  "integrations",
  "research",
  "sandbox",
  "skills",
]);

const ToolSummarySchema = z.strictObject({
  artifactPresentation: z.enum(["deliverable", "none", "tool-evidence"]),
  description: z.string(),
  domain: ToolDomainSchema,
  name: z.string(),
  usesSandbox: z.boolean(),
});

export const UpsertProviderKeySchema = z.strictObject({
  provider: ProviderSchema,
  key: z.string().trim().min(1).max(20_000),
});

export const SandboxFilePathSchema = z
  .string()
  .min(1)
  .max(1_000)
  .regex(
    /^\/workspace(?:\/(?!\.{1,2}(?:\/|$))[^/\0]+)*$/,
    "Path must be canonical and stay under /workspace.",
  );

const SandboxFileEntrySchema = z.strictObject(sandboxFileEntryShape(SandboxFilePathSchema));

export const SandboxTerminalCommandSchema = z.strictObject({
  command: z.string().min(1).max(2_000),
  cwd: SandboxFilePathSchema.default("/workspace"),
  timeoutMs: z.number().int().positive().max(60_000).default(30_000),
});

export const SandboxTerminalResultSchema = z.strictObject(
  extendSandboxExecResultShape({
    cwd: SandboxFilePathSchema.optional(),
  }),
);

export const SandboxTerminalContextSchema = z.strictObject({
  cwd: SandboxFilePathSchema,
  displayCwd: z.string().min(1).max(1_000),
  displayWorkspacePath: z.string().min(1).max(200),
  host: z.string().min(1).max(200),
});

export const SandboxIdeSessionSchema = z.strictObject({
  displayWorkspacePath: z.string().min(1).max(1_000),
  expiresAt: z.string().datetime(),
  port: z.number().int().positive().max(65_535),
  url: z.string().url(),
  workspacePath: SandboxFilePathSchema,
});

const BrowserTakeoverActiveSchema = z.strictObject({
  expiresAt: z.string().datetime(),
  status: z.literal("active"),
  takeoverId: z.string().uuid(),
});

export const BrowserTakeoverStatusSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("inactive") }),
  BrowserTakeoverActiveSchema,
]);

export const BrowserTakeoverSessionSchema = z.strictObject({
  ...BrowserTakeoverActiveSchema.shape,
  url: z.string().url(),
});

export const BrowserTakeoverResumeSchema = z.strictObject({ takeoverId: z.string().uuid() });

export const BrowserTakeoverResumeResultSchema = z.strictObject({
  ok: z.literal(true),
  status: z.literal("inactive"),
});

/**
 * Response of waking the app preview: the sandbox is (re)started and the dev server relaunched
 * if it had idle-stopped. `running` reports whether the dev-server port answered; `url` is a
 * fresh preview URL. Empty `url` means no dev server is tracked for this sandbox.
 */
export const SandboxPreviewWakeSchema = z.strictObject({
  expiresAt: z.string().datetime().optional(),
  expoUrl: z.string().optional(),
  port: z.number().int().positive().max(65_535).optional(),
  running: z.boolean(),
  state: z.string().min(1).max(50),
  url: z.string().url().optional(),
});

/**
 * Current app-preview state for the preview panel. `state: "none"` means this project has no
 * tracked dev server; otherwise `state` carries the current sandbox lifecycle state and `running`
 * reports whether the tracked server's port is live.
 */
export const SandboxPreviewStatusSchema = z.strictObject({
  running: z.boolean(),
  state: z.string().min(1).max(50),
  updatedAt: z.string().datetime().optional(),
});

/**
 * Cursor-polling query for the dev-server console strip. Cursors are character
 * offsets into Daytona's accumulated per-stream log text; `lastPid` is echoed
 * from the previous snapshot's process so the DO can detect a same-name
 * dev-server restart (differing non-null pid forces a buffer reset). `processId`
 * defaults to the deterministic dev-server id `app-preview`.
 */
export const SandboxConsoleQuerySchema = z.strictObject({
  lastPid: z.string().min(1).max(100).optional(),
  processId: z.string().min(1).max(200).default("app-preview"),
  stderrCursor: z.coerce.number().int().min(0).default(0),
  stdoutCursor: z.coerce.number().int().min(0).default(0),
  tail: z.coerce.number().int().min(1).max(500).default(200),
});

/**
 * One console line tagged only with its source stream. Severity (error/warn/
 * info) is intentionally NOT on the wire — it is a presentation concern parsed
 * client-side so its heuristics can iterate without a worker redeploy.
 */
const SandboxConsoleLineSchema = z.strictObject({
  stream: z.enum(["stdout", "stderr"]),
  text: z.string().max(2_000),
});

/**
 * Resolved dev-server process. `pid` is the Daytona restart identity (string |
 * number upstream, normalized via `String()`), null when Daytona omits it.
 * `status` is the raw Daytona process status ("running" | "completed" | ...).
 */
const SandboxConsoleProcessSchema = z.strictObject({
  command: z.string(),
  id: z.string(),
  pid: z.string().nullable(),
  status: z.string(),
});

/**
 * Console snapshot returned by `GET /v1/threads/:threadId/sandbox/console`.
 * `reset: true` ⇒ the log buffer restarted (process restart / rotation); the
 * client must clear its buffer and reset cursors. `truncated: true` ⇒ more
 * lines existed than `tail`. `process: null` ⇒ no sandbox / no resolvable
 * dev-server process (the client backs polling off, never resurrecting the box).
 */
export const SandboxConsoleSnapshotSchema = z.strictObject({
  cursor: z.strictObject({ stderr: z.number().int().min(0), stdout: z.number().int().min(0) }),
  lines: z.array(SandboxConsoleLineSchema).max(500),
  process: SandboxConsoleProcessSchema.nullable(),
  reset: z.boolean(),
  truncated: z.boolean(),
});

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.strictObject({
    data: z.array(item),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  });

export const ActivityQuerySchema = z.strictObject({
  days: z.coerce.number().int().min(1).max(366).default(30),
});

const ActivityRunPointSchema = z.strictObject({
  runId: z.string().uuid(),
  startedAt: z.string().datetime(),
  status: z.string(),
});

const SandboxHourPointSchema = z.strictObject({
  hours: z.number().positive(),
  recordedAt: z.string().datetime(),
});

export const ActivityHistoryResponseSchema = z.strictObject({
  days: z.number().int().positive(),
  runs: z.array(ActivityRunPointSchema),
  sandboxHours: z.array(SandboxHourPointSchema),
  truncated: z.boolean(),
});

export const SearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

const SearchResultProjectSchema = z.strictObject({
  type: z.literal("project"),
  id: z.string().uuid(),
  name: z.string(),
  latestThreadId: z.string().uuid().nullable(),
  updatedAt: z.string().datetime(),
});

const SearchResultThreadSchema = z.strictObject({
  type: z.literal("thread"),
  id: z.string().uuid(),
  title: z.string(),
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  updatedAt: z.string().datetime(),
  // Non-null while a run is in flight (backs the sidebar's running-chat spinner).
  activeRunId: z.string().uuid().nullable(),
});

const SearchResultSchema = z.discriminatedUnion("type", [
  SearchResultProjectSchema,
  SearchResultThreadSchema,
]);

export const SearchResponseSchema = z.strictObject({
  query: z.string(),
  results: z.array(SearchResultSchema),
});

/** `GET /v1/threads` — the user's recent chats (threads) across all projects, newest first. */
export const RecentThreadsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const RecentThreadsResponseSchema = z.strictObject({
  threads: z.array(SearchResultThreadSchema),
});

export const GreetingResponseSchema = z.strictObject({
  city: z.string().nullable(),
  timezone: z.string().nullable(),
  weather: z
    .strictObject({
      tempC: z.number(),
      weatherCode: z.number().int(),
    })

    .nullable(),
  workedMinutesToday: z.number().int().nonnegative(),
});

/** Operational ceiling that keeps the per-user skill catalog bounded. */
export const MAX_USER_SKILLS = 100;

/** A user-created skill (client-safe projection; `body` only travels on detail/create). */
export const UserSkillSchema = z.strictObject({
  category: z.string().max(80),
  createdAt: z.string().datetime(),
  description: z.string().max(400),
  id: z.string().uuid(),
  name: z.string().max(80),
  tags: z.array(z.string().max(40)).max(12),
  updatedAt: z.string().datetime(),
});

export const UserSkillsResponseSchema = z.strictObject({
  skills: z.array(UserSkillSchema).max(MAX_USER_SKILLS),
});

export type SandboxHourPoint = z.infer<typeof SandboxHourPointSchema>;
export type CreateRun = z.infer<typeof CreateRunSchema>;
export type CreateThread = z.infer<typeof CreateThreadSchema>;
export type RunIntent = z.infer<typeof RunIntentSchema>;
export type GreetingResponse = z.infer<typeof GreetingResponseSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SearchResultThread = z.infer<typeof SearchResultThreadSchema>;
export type Integration = z.infer<typeof IntegrationSchema>;
export type IntegrationAccount = z.infer<typeof IntegrationAccountSchema>;
export type IntegrationCatalog = z.infer<typeof IntegrationCatalogSchema>;
export type ToolkitAction = z.infer<typeof ToolkitActionSchema>;
export type ToolkitActionsResponse = z.infer<typeof ToolkitActionsResponseSchema>;
export type ToolkitCatalogEntry = z.infer<typeof ToolkitCatalogEntrySchema>;
export type ToolkitCategory = z.infer<typeof ToolkitCategorySchema>;
export type ProjectMode = z.infer<typeof ProjectModeSchema>;
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
export type ProjectFileList = z.infer<typeof ProjectFileListSchema>;
export type ProjectFileUploadResponse = z.infer<typeof ProjectFileUploadResponseSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type ProviderKeySummary = z.infer<typeof ProviderKeySummarySchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type ToolSummary = z.infer<typeof ToolSummarySchema>;
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
export type UpdateThread = z.infer<typeof UpdateThreadSchema>;
export type SandboxConsoleLine = z.infer<typeof SandboxConsoleLineSchema>;
export type SandboxConsoleProcess = z.infer<typeof SandboxConsoleProcessSchema>;
export type SandboxConsoleSnapshot = z.infer<typeof SandboxConsoleSnapshotSchema>;
export type SandboxFileEntry = z.infer<typeof SandboxFileEntrySchema>;
export type SandboxIdeSession = z.infer<typeof SandboxIdeSessionSchema>;
export type BrowserTakeoverStatus = z.infer<typeof BrowserTakeoverStatusSchema>;
export type BrowserTakeoverSession = z.infer<typeof BrowserTakeoverSessionSchema>;
export type SandboxPreviewWake = z.infer<typeof SandboxPreviewWakeSchema>;
export type SandboxPreviewStatus = z.infer<typeof SandboxPreviewStatusSchema>;
export type SandboxTerminalContext = z.infer<typeof SandboxTerminalContextSchema>;
export type SandboxTerminalResult = z.infer<typeof SandboxTerminalResultSchema>;
export type ActivityHistoryResponse = z.infer<typeof ActivityHistoryResponseSchema>;
export type ActivityRunPoint = z.infer<typeof ActivityRunPointSchema>;
export type UserSkill = z.infer<typeof UserSkillSchema>;
