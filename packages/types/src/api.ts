import { z } from "zod";
import { IntegrationNameSchema } from "./integrations";
import { LogicalModelIdSchema } from "./models";
import { MessagePartsSchema } from "./ui-message";

export { MessagePartSchema } from "./ui-message";

/** Canonical total character budget for one submitted user message, including inline attachments. */
export const USER_MESSAGE_MAX_CHARACTERS = 20_000;

const UserTextPartSchema = z
  .object({
    text: z.string().trim().min(1).max(USER_MESSAGE_MAX_CHARACTERS),
    type: z.literal("text"),
  })
  .strict();

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

export const PROJECT_MODES = ["app-builder", "app-builder-mobile", "general"] as const;
export const ProjectModeSchema = z.enum(PROJECT_MODES);

/** Explicit one-run product modes. These are UI intent, never inferred from prompt text. */
export const RUN_INTENTS = ["skill-creator"] as const;
export const RunIntentSchema = z.enum(RUN_INTENTS);

export const CreateProjectSchema = z
  .object({
    defaultModel: LogicalModelIdSchema.optional(),
    importRepoUrl: GitHubRepoUrlSchema.optional(),
    name: z.string().trim().min(1).max(120),
    mode: ProjectModeSchema.default("general"),
  })
  .strict();

export const CreateThreadSchema = z
  .object({
    defaultModel: LogicalModelIdSchema.optional(),
    initialPrompt: z.string().trim().min(1).max(20_000).optional(),
    importRepoUrl: GitHubRepoUrlSchema.optional(),
    mode: ProjectModeSchema.optional(),
    projectId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const UpdateThreadSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export const ProjectSummarySchema = z
  .object({
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
  })
  .strict();

export const UpdateProjectSchema = z
  .object({
    defaultModel: LogicalModelIdSchema.nullable().optional(),
    importRepoUrl: GitHubRepoUrlSchema.nullable().optional(),
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one project field is required.",
  });

export const ThreadSchema = z
  .object({
    activeRunId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
    id: z.string().uuid(),
    latestModelId: LogicalModelIdSchema.nullable(),
    pendingInitialPrompt: z.string().nullable(),
    projectId: z.string().uuid().nullable(),
    title: z.string().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const UIMessageRecordSchema = z
  .object({
    agentRunId: z.string().uuid().nullable(),
    agentRunSegment: z.number().int().nonnegative(),
    agentRunSegmentFinal: z.boolean(),
    createdAt: z.string().datetime(),
    id: z.string().uuid(),
    parts: MessagePartsSchema,
    role: z.enum(["assistant", "user"]),
    threadId: z.string().uuid(),
  })
  .strict();

export const PaginationQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

/** Exact maximum size of a finalized project-download ZIP across server and web clients. */
export const PROJECT_ARCHIVE_MAX_OUTPUT_BYTES = 640 * 1024 * 1024;

export const CreateRunSchema = z
  .object({
    intent: RunIntentSchema.optional(),
    message: z
      .object({
        id: z.string().uuid().optional(),
        role: z.enum(["user"]),
        parts: z.array(UserTextPartSchema).length(1),
      })
      .strict(),
    model: LogicalModelIdSchema.optional(),
  })
  .strict();

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

export const ProviderKeySummarySchema = z
  .object({
    disabledAt: z.string().datetime().nullable(),
    disabledReason: z.string().nullable(),
    provider: ProviderSchema,
  })
  .strict();

export const ComposioConnectionIdSchema = z.string().trim().min(1).max(256);

const IntegrationStatusSchema = z.enum([
  "not_connected",
  "initiating",
  "active",
  "inactive",
  "expired",
  "failed",
]);

const IntegrationAccountSchema = z
  .object({
    connectedAt: z.string().datetime(),
    connectionId: ComposioConnectionIdSchema,
    isDefault: z.boolean(),
    label: z.string(),
    status: IntegrationStatusSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();

export const IntegrationSchema = z
  .object({
    accounts: z.array(IntegrationAccountSchema),
    displayName: z.string(),
    name: IntegrationNameSchema,
    status: IntegrationStatusSchema,
  })
  .strict();

export const IntegrationConnectResponseSchema = z
  .object({
    oauthUrl: z.string().url(),
  })
  .strict();

const ToolkitCategorySchema = z
  .object({
    name: z.string(),
    slug: z.string(),
  })
  .strict();

const ToolkitCatalogEntrySchema = z
  .object({
    accounts: z.array(IntegrationAccountSchema),
    categorySlugs: z.array(z.string()),
    connectable: z.boolean(),
    description: z.string(),
    displayName: z.string(),
    name: IntegrationNameSchema,
    status: IntegrationStatusSchema,
  })
  .strict();

export const IntegrationCatalogSchema = z
  .object({
    categories: z.array(ToolkitCategorySchema),
    toolkits: z.array(ToolkitCatalogEntrySchema),
  })
  .strict();

const ToolkitActionSchema = z
  .object({
    description: z.string(),
    name: z.string(),
    slug: z.string(),
  })
  .strict();

export const ToolkitActionsResponseSchema = z
  .object({
    actions: z.array(ToolkitActionSchema),
  })
  .strict();

export const ToolDomainSchema = z.enum([
  "browser",
  "code",
  "data",
  "docs",
  "integrations",
  "research",
  "sandbox",
  "skills",
]);

export const ToolSummarySchema = z
  .object({
    description: z.string(),
    domain: ToolDomainSchema,
    name: z.string(),
    producesArtifact: z.boolean(),
    usesSandbox: z.boolean(),
  })
  .strict();

export const AgentSummarySchema = z
  .object({
    description: z.string(),
    name: z.string(),
  })
  .strict();

export const UpsertProviderKeySchema = z
  .object({
    provider: ProviderSchema,
    key: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const SandboxFilePathSchema = z
  .string()
  .min(1)
  .max(1_000)
  .regex(
    /^\/workspace(?:\/(?!\.{1,2}(?:\/|$))[^/\0]+)*$/,
    "Path must be canonical and stay under /workspace.",
  );

const SandboxFileEntrySchema = z
  .object({
    modifiedAt: z.string(),
    name: z.string(),
    path: SandboxFilePathSchema,
    relativePath: z.string(),
    size: z.number().int().nonnegative(),
    type: z.enum(["file", "directory", "symlink", "other"]),
  })
  .strict();

export const SandboxFileListSchema = z
  .object({
    files: z.array(SandboxFileEntrySchema),
    path: SandboxFilePathSchema,
  })
  .strict();

export const SandboxFileSchema = z
  .object({
    content: z.string(),
    encoding: z.enum(["utf8", "base64"]),
    path: SandboxFilePathSchema,
  })
  .strict();

export const SandboxFilePreviewSchema = z
  .object({
    content: z.string().max(30_000_000).nullable(),
    encoding: z.literal("base64").nullable(),
    error: z.string().max(1_000).nullable(),
    kind: z.enum(["image", "pdf", "unsupported"]),
    mimeType: z.string().min(1).max(200).nullable(),
    path: SandboxFilePathSchema,
    previewPath: SandboxFilePathSchema.nullable(),
  })
  .strict();

const UpdateSandboxFileSchema = z
  .object({
    content: z.string().max(2_000_000),
    encoding: z.enum(["utf8", "base64"]).default("utf8"),
  })
  .strict();

export const UpdateSandboxPathFileSchema = UpdateSandboxFileSchema.extend({
  path: SandboxFilePathSchema,
}).strict();

export const SandboxFileWriteSchema = z
  .object({
    path: SandboxFilePathSchema,
    success: z.boolean(),
  })
  .strict();

export const SandboxTerminalCommandSchema = z
  .object({
    command: z.string().min(1).max(2_000),
    cwd: SandboxFilePathSchema.default("/workspace"),
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const SandboxTerminalResultSchema = z
  .object({
    command: z.string(),
    cwd: SandboxFilePathSchema.optional(),
    durationMs: z.number().int().nonnegative().optional(),
    exitCode: z.number().int(),
    stderr: z.string(),
    stdout: z.string(),
    success: z.boolean(),
  })
  .strict();

export const SandboxTerminalContextSchema = z
  .object({
    cwd: SandboxFilePathSchema,
    displayCwd: z.string().min(1).max(1_000),
    displayWorkspacePath: z.string().min(1).max(200),
    host: z.string().min(1).max(200),
  })
  .strict();

export const SandboxIdeSessionSchema = z
  .object({
    displayWorkspacePath: z.string().min(1).max(1_000),
    expiresAt: z.string().datetime(),
    port: z.number().int().positive().max(65_535),
    url: z.string().url(),
    workspacePath: SandboxFilePathSchema,
  })
  .strict();

export const BrowserTakeoverActiveSchema = z
  .object({
    expiresAt: z.string().datetime(),
    status: z.literal("active"),
    takeoverId: z.string().uuid(),
  })
  .strict();

export const BrowserTakeoverStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("inactive") }).strict(),
  BrowserTakeoverActiveSchema,
]);

export const BrowserTakeoverSessionSchema = BrowserTakeoverActiveSchema.extend({
  url: z.string().url(),
}).strict();

export const BrowserTakeoverResumeSchema = z.object({ takeoverId: z.string().uuid() }).strict();

export const BrowserTakeoverResumeResultSchema = z
  .object({ ok: z.literal(true), status: z.literal("inactive") })
  .strict();

/**
 * Response of waking the app preview: the sandbox is (re)started and the dev server relaunched
 * if it had idle-stopped. `running` reports whether the dev-server port answered; `url` is a
 * fresh preview URL. Empty `url` means no dev server is tracked for this sandbox.
 */
export const SandboxPreviewWakeSchema = z
  .object({
    expiresAt: z.string().datetime().optional(),
    expoUrl: z.string().optional(),
    port: z.number().int().positive().max(65_535).optional(),
    running: z.boolean(),
    state: z.string().min(1).max(50),
    url: z.string().url().optional(),
  })
  .strict();

/**
 * Current sandbox lifecycle state for the preview panel. Kept fresh by Daytona
 * `sandbox.state.updated` webhooks (falls back to a live read). `running` is true only in the
 * `started` state; the panel uses this to show a booting spinner or a resume affordance.
 */
export const SandboxPreviewStatusSchema = z
  .object({
    running: z.boolean(),
    state: z.string().min(1).max(50),
    updatedAt: z.string().datetime().optional(),
  })
  .strict();

/**
 * Cursor-polling query for the dev-server console strip. Cursors are character
 * offsets into Daytona's accumulated per-stream log text; `lastPid` is echoed
 * from the previous snapshot's process so the DO can detect a same-name
 * dev-server restart (differing non-null pid forces a buffer reset). `processId`
 * defaults to the deterministic dev-server id `app-preview`.
 */
export const SandboxConsoleQuerySchema = z
  .object({
    lastPid: z.string().min(1).max(100).optional(),
    processId: z.string().min(1).max(200).default("app-preview"),
    stderrCursor: z.coerce.number().int().min(0).default(0),
    stdoutCursor: z.coerce.number().int().min(0).default(0),
    tail: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();

/**
 * One console line tagged only with its source stream. Severity (error/warn/
 * info) is intentionally NOT on the wire — it is a presentation concern parsed
 * client-side so its heuristics can iterate without a worker redeploy.
 */
const SandboxConsoleLineSchema = z
  .object({
    stream: z.enum(["stdout", "stderr"]),
    text: z.string().max(2_000),
  })
  .strict();

/**
 * Resolved dev-server process. `pid` is the Daytona restart identity (string |
 * number upstream, normalized via `String()`), null when Daytona omits it.
 * `status` is the raw Daytona process status ("running" | "completed" | ...).
 */
const SandboxConsoleProcessSchema = z
  .object({
    command: z.string(),
    id: z.string(),
    pid: z.string().nullable(),
    status: z.string(),
  })
  .strict();

/**
 * Console snapshot returned by `GET /v1/threads/:threadId/sandbox/console`.
 * `reset: true` ⇒ the log buffer restarted (process restart / rotation); the
 * client must clear its buffer and reset cursors. `truncated: true` ⇒ more
 * lines existed than `tail`. `process: null` ⇒ no sandbox / no resolvable
 * dev-server process (the client backs polling off, never resurrecting the box).
 */
export const SandboxConsoleSnapshotSchema = z
  .object({
    cursor: z.object({ stderr: z.number().int().min(0), stdout: z.number().int().min(0) }).strict(),
    lines: z.array(SandboxConsoleLineSchema).max(500),
    process: SandboxConsoleProcessSchema.nullable(),
    reset: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      data: z.array(item),
      next_cursor: z.string().nullable(),
      has_more: z.boolean(),
    })
    .strict();

export const ActivityQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(366).default(30),
  })
  .strict();

const ActivityRunPointSchema = z
  .object({
    runId: z.string().uuid(),
    startedAt: z.string().datetime(),
    status: z.string(),
  })
  .strict();

const SandboxHourPointSchema = z
  .object({
    hours: z.number().positive(),
    recordedAt: z.string().datetime(),
  })
  .strict();

export const ActivityHistoryResponseSchema = z
  .object({
    days: z.number().int().positive(),
    runs: z.array(ActivityRunPointSchema),
    sandboxHours: z.array(SandboxHourPointSchema),
    truncated: z.boolean(),
  })
  .strict();

export const SearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100),
    limit: z.coerce.number().int().min(1).max(20).default(10),
  })
  .strict();

const SearchResultProjectSchema = z
  .object({
    type: z.literal("project"),
    id: z.string().uuid(),
    name: z.string(),
    latestThreadId: z.string().uuid().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const SearchResultThreadSchema = z
  .object({
    type: z.literal("thread"),
    id: z.string().uuid(),
    title: z.string(),
    projectId: z.string().uuid().nullable(),
    projectName: z.string().nullable(),
    updatedAt: z.string().datetime(),
    // Non-null while a run is in flight (backs the sidebar's running-chat spinner).
    activeRunId: z.string().uuid().nullable(),
  })
  .strict();

const SearchResultSchema = z.discriminatedUnion("type", [
  SearchResultProjectSchema,
  SearchResultThreadSchema,
]);

export const SearchResponseSchema = z
  .object({
    query: z.string(),
    results: z.array(SearchResultSchema),
  })
  .strict();

/** `GET /v1/threads` — the user's recent chats (threads) across all projects, newest first. */
export const RecentThreadsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const RecentThreadsResponseSchema = z
  .object({
    threads: z.array(SearchResultThreadSchema),
  })
  .strict();

export const GreetingResponseSchema = z
  .object({
    city: z.string().nullable(),
    timezone: z.string().nullable(),
    weather: z
      .object({
        tempC: z.number(),
        weatherCode: z.number().int(),
      })
      .strict()
      .nullable(),
    workedMinutesToday: z.number().int().nonnegative(),
  })
  .strict();

/** Operational ceiling that keeps the per-user skill catalog bounded. */
export const MAX_USER_SKILLS = 100;

/** A user-created skill (client-safe projection; `body` only travels on detail/create). */
export const UserSkillSchema = z
  .object({
    category: z.string().max(80),
    createdAt: z.string().datetime(),
    description: z.string().max(400),
    id: z.string().uuid(),
    name: z.string().max(80),
    tags: z.array(z.string().max(40)).max(12),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const UserSkillsResponseSchema = z
  .object({ skills: z.array(UserSkillSchema).max(MAX_USER_SKILLS) })
  .strict();

export type SandboxHourPoint = z.infer<typeof SandboxHourPointSchema>;
export type CreateRun = z.infer<typeof CreateRunSchema>;
export type CreateThread = z.infer<typeof CreateThreadSchema>;
export type RunIntent = z.infer<typeof RunIntentSchema>;
export type GreetingResponse = z.infer<typeof GreetingResponseSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SearchResultThread = z.infer<typeof SearchResultThreadSchema>;
export type AgentSummary = z.infer<typeof AgentSummarySchema>;
export type Integration = z.infer<typeof IntegrationSchema>;
export type IntegrationAccount = z.infer<typeof IntegrationAccountSchema>;
export type IntegrationCatalog = z.infer<typeof IntegrationCatalogSchema>;
export type ToolkitAction = z.infer<typeof ToolkitActionSchema>;
export type ToolkitActionsResponse = z.infer<typeof ToolkitActionsResponseSchema>;
export type ToolkitCatalogEntry = z.infer<typeof ToolkitCatalogEntrySchema>;
export type ToolkitCategory = z.infer<typeof ToolkitCategorySchema>;
export type ProjectMode = z.infer<typeof ProjectModeSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type ProviderKeySummary = z.infer<typeof ProviderKeySummarySchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type ToolSummary = z.infer<typeof ToolSummarySchema>;
export type UIMessageRecord = z.infer<typeof UIMessageRecordSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
export type UpdateThread = z.infer<typeof UpdateThreadSchema>;
export type SandboxConsoleLine = z.infer<typeof SandboxConsoleLineSchema>;
export type SandboxConsoleProcess = z.infer<typeof SandboxConsoleProcessSchema>;
export type SandboxConsoleSnapshot = z.infer<typeof SandboxConsoleSnapshotSchema>;
export type SandboxFileEntry = z.infer<typeof SandboxFileEntrySchema>;
export type SandboxFilePreview = z.infer<typeof SandboxFilePreviewSchema>;
export type SandboxIdeSession = z.infer<typeof SandboxIdeSessionSchema>;
export type BrowserTakeoverStatus = z.infer<typeof BrowserTakeoverStatusSchema>;
export type BrowserTakeoverSession = z.infer<typeof BrowserTakeoverSessionSchema>;
export type BrowserTakeoverResume = z.infer<typeof BrowserTakeoverResumeSchema>;
export type BrowserTakeoverResumeResult = z.infer<typeof BrowserTakeoverResumeResultSchema>;
export type SandboxPreviewWake = z.infer<typeof SandboxPreviewWakeSchema>;
export type SandboxPreviewStatus = z.infer<typeof SandboxPreviewStatusSchema>;
export type SandboxTerminalContext = z.infer<typeof SandboxTerminalContextSchema>;
export type SandboxTerminalResult = z.infer<typeof SandboxTerminalResultSchema>;
export type ActivityHistoryResponse = z.infer<typeof ActivityHistoryResponseSchema>;
export type ActivityRunPoint = z.infer<typeof ActivityRunPointSchema>;
export type UserSkill = z.infer<typeof UserSkillSchema>;
export type ToolDomain = z.infer<typeof ToolDomainSchema>;
