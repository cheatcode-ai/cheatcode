import { z } from "zod";

export const MessagePartSchema = z
  .object({
    type: z.string(),
  })
  .catchall(z.unknown());

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

export const CreateProjectSchema = z
  .object({
    budgetCapUsd: z.number().positive().max(50).optional(),
    defaultModel: z.string().trim().min(1).max(200).optional(),
    importRepoUrl: GitHubRepoUrlSchema.optional(),
    name: z.string().trim().min(1).max(120),
    mode: z.enum(["app-builder", "app-builder-mobile", "general"]).default("general"),
    masterInstructions: z.string().max(20_000).optional(),
  })
  .strict();

export const CreateThreadSchema = z
  .object({
    defaultModel: z.string().trim().min(1).max(200).optional(),
    initialPrompt: z.string().trim().min(1).max(20_000).optional(),
    importRepoUrl: GitHubRepoUrlSchema.optional(),
    mode: z.enum(["app-builder", "app-builder-mobile", "general"]).optional(),
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
    archivedPendingAction: z.boolean(),
    budgetCapUsd: z.number().positive().max(50).nullable(),
    createdAt: z.string().datetime(),
    defaultModel: z.string().trim().min(1).max(200).nullable(),
    id: z.string().uuid(),
    importRepoUrl: z.string().nullable(),
    masterInstructions: z.string().nullable(),
    mode: z.string(),
    name: z.string(),
    overQuota: z.boolean(),
    readOnly: z.boolean(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const UpdateProjectSchema = z
  .object({
    budgetCapUsd: z.number().positive().max(50).nullable().optional(),
    defaultModel: z.string().trim().min(1).max(200).nullable().optional(),
    importRepoUrl: GitHubRepoUrlSchema.nullable().optional(),
    masterInstructions: z.string().max(20_000).nullable().optional(),
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
    pendingInitialPrompt: z.string().nullable().optional(),
    projectId: z.string().uuid().nullable(),
    title: z.string().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const UIMessageRecordSchema = z
  .object({
    agentRunId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
    id: z.string().uuid(),
    parts: z.array(MessagePartSchema),
    role: z.string(),
    threadId: z.string().uuid(),
  })
  .strict();

export const PaginationQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const CreateRunSchema = z
  .object({
    message: z
      .object({
        id: z.string().optional(),
        role: z.enum(["user"]),
        parts: z.array(MessagePartSchema).min(1),
      })
      .strict(),
    model: z.string().optional(),
    agentName: z.string().optional(),
    budgetCapUsd: z.number().positive().max(50).optional(),
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
  "llamaparse",
]);

export type Provider = z.infer<typeof ProviderSchema>;

export const ProviderKeySummarySchema = z
  .object({
    disabledAt: z.string().datetime().nullable(),
    disabledReason: z.string().nullable(),
    provider: ProviderSchema,
    fingerprint: z.string(),
    lastUsedAt: z.string().nullable(),
  })
  .strict();

// A Composio toolkit slug (e.g. "github", "google_calendar"). Previously a 5-value
// enum; widened to the full Composio catalog so any managed-auth toolkit can be
// browsed, connected, and used by the agent.
export const IntegrationNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, "Toolkit slug must be lowercase letters, digits, or underscores.");

export const IntegrationStatusSchema = z.enum([
  "not_connected",
  "initiating",
  "active",
  "inactive",
  "expired",
  "failed",
]);

export const IntegrationSchema = z
  .object({
    connectedAt: z.string().datetime().nullable(),
    connectionId: z.string().nullable(),
    displayName: z.string(),
    name: IntegrationNameSchema,
    status: IntegrationStatusSchema,
    updatedAt: z.string().datetime().nullable(),
  })
  .strict();

export const IntegrationConnectResponseSchema = z
  .object({
    oauthUrl: z.string().url(),
  })
  .strict();

export const ToolkitCategorySchema = z
  .object({
    name: z.string(),
    slug: z.string(),
  })
  .strict();

export const ToolkitCatalogEntrySchema = z
  .object({
    categorySlugs: z.array(z.string()),
    connectable: z.boolean(),
    connectedAt: z.string().datetime().nullable(),
    description: z.string(),
    displayName: z.string(),
    name: IntegrationNameSchema,
    status: IntegrationStatusSchema,
    updatedAt: z.string().datetime().nullable(),
  })
  .strict();

export const IntegrationCatalogSchema = z
  .object({
    categories: z.array(ToolkitCategorySchema),
    toolkits: z.array(ToolkitCatalogEntrySchema),
  })
  .strict();

export const ToolkitActionSchema = z
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

export const ToolSummarySchema = z
  .object({
    description: z.string(),
    domain: z.string(),
    name: z.string(),
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

export const BillingTierSchema = z.enum(["free", "pro", "premium", "ultra", "max"]);

export const PaidBillingTierSchema = z.enum(["pro", "premium", "ultra", "max"]);

export const BillingCheckoutSchema = z
  .object({
    tier: PaidBillingTierSchema,
    returnUrl: z.string().url().max(2000).optional(),
    successUrl: z.string().url().max(2000).optional(),
  })
  .strict();

export const BillingCancellationReasonSchema = z.enum([
  "too_expensive",
  "missing_features",
  "switched_service",
  "unused",
  "customer_service",
  "low_quality",
  "too_complex",
  "other",
]);

export const BillingCancelSchema = z
  .object({
    comment: z.string().trim().max(1_000).optional(),
    reason: BillingCancellationReasonSchema.optional(),
  })
  .strict();

export const BillingStateResponseSchema = z
  .object({
    cancelAtPeriodEnd: z.boolean(),
    canCancel: z.boolean(),
    canReactivate: z.boolean(),
    currentPeriodEnd: z.string().datetime().nullable(),
    currentPeriodStart: z.string().datetime().nullable(),
    subscriptionStatus: z.string(),
    tier: BillingTierSchema,
  })
  .strict();

export const BillingSubscriptionActionResponseSchema = z
  .object({
    cancelAtPeriodEnd: z.boolean(),
    currentPeriodEnd: z.string().datetime().nullable(),
    currentPeriodStart: z.string().datetime().nullable(),
    status: z.string(),
  })
  .strict();

export const BillingUrlResponseSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

export const SandboxUsageWarnLevelSchema = z.enum(["none", "warn80", "warn95", "exhausted"]);

export const SandboxUsageSummaryResponseSchema = z
  .object({
    resetAt: z.string().datetime(),
    sandboxHoursTotal: z.number().nonnegative(),
    sandboxHoursUsed: z.number().nonnegative(),
    tier: BillingTierSchema,
    warnLevel: SandboxUsageWarnLevelSchema,
  })
  .strict();

export const PlanSummarySchema = z
  .object({
    available: z.boolean(),
    current: z.boolean(),
    displayName: z.string(),
    id: BillingTierSchema,
    limits: z
      .object({
        dailyCostCapUsd: z.number().nullable(),
        maxConcurrentSandboxes: z.number().int().positive(),
        maxProjects: z.number().int().positive().nullable(),
        quotaComposioCalls: z.number().int().positive().nullable(),
        quotaDeployments: z.number().int().positive().nullable(),
      })
      .strict(),
    monthlyPriceUsd: z.number().nonnegative(),
    sandboxHoursPerMonth: z.number().positive(),
  })
  .strict();

export const BillingCatalogResponseSchema = z
  .object({
    currentTier: BillingTierSchema,
    plans: z.array(PlanSummarySchema),
  })
  .strict();

/** Alias of BillingCatalogResponseSchema for catalog-named consumers. */
export const PlanCatalogResponseSchema = BillingCatalogResponseSchema;

export const SandboxFilePathSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine(
    (path) =>
      !path.includes("\0") &&
      !path.split("/").includes("..") &&
      (path === "/workspace" || path.startsWith("/workspace/")),
    {
      message: "Path must stay under /workspace.",
    },
  );

export const SandboxFileEntrySchema = z
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

export const UpdateSandboxFileSchema = z
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
 * `started` state; the panel uses this to show a booting spinner or a paused/resume affordance.
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
export const SandboxConsoleLineSchema = z
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
export const SandboxConsoleProcessSchema = z
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

/** Body of `POST /v1/runs/:runId/approvals/:approvalId`. */
export const ApprovalDecisionRequestSchema = z
  .object({
    decision: z.enum(["allow", "deny"]),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

/** Resolution echoed by the approval decision route (idempotent replays). */
export const ApprovalDecisionResponseSchema = z
  .object({
    ok: z.literal(true),
    approvalId: z.string().uuid(),
    decision: z.enum(["allow", "deny"]),
    decidedBy: z.enum(["user", "timeout", "cancel"]),
    runStatus: z.enum(["running", "paused", "completed", "failed", "canceled"]),
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

export const LimitsSnapshotSchema = z
  .object({
    rate_limits: z.record(
      z.string(),
      z
        .object({
          limit: z.number(),
          remaining: z.number(),
          reset_at: z.number(),
        })
        .strict(),
    ),
    quotas: z.record(
      z.string(),
      z
        .object({
          limit: z.number(),
          used: z.number(),
          period_end: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const UsageDailyQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(90).default(30),
  })
  .strict();

export const UsageDailyTotalSchema = z
  .object({
    agentRunCount: z.number().int().nonnegative(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    totalCachedTokens: z.number().int().nonnegative(),
    totalCostUsd: z.number().nonnegative(),
    totalInputTokens: z.number().int().nonnegative(),
    totalOutputTokens: z.number().int().nonnegative(),
  })
  .strict();

export const UsageRunPointSchema = z
  .object({
    runId: z.string().uuid(),
    startedAt: z.string().datetime(),
    status: z.string(),
  })
  .strict();

export const UsageDailyTotalsResponseSchema = z
  .object({
    days: z.number().int().positive(),
    runs: z.array(UsageRunPointSchema),
    totals: z.array(UsageDailyTotalSchema),
    truncated: z.boolean(),
  })
  .strict();

export const SearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100),
    limit: z.coerce.number().int().min(1).max(20).default(10),
  })
  .strict();

export const SearchResultProjectSchema = z
  .object({
    type: z.literal("project"),
    id: z.string().uuid(),
    name: z.string(),
    latestThreadId: z.string().uuid().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const SearchResultThreadSchema = z
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

export const SearchResultSchema = z.discriminatedUnion("type", [
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

/** A user-created skill (client-safe projection; `body` only travels on detail/create). */
export const UserSkillSchema = z
  .object({
    category: z.string(),
    createdAt: z.string().datetime(),
    description: z.string(),
    id: z.string().uuid(),
    name: z.string(),
    tags: z.array(z.string()),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const UserSkillsResponseSchema = z.object({ skills: z.array(UserSkillSchema) }).strict();

/** Body of `POST /v1/skills` — create/update a custom skill (by name). */
export const CreateUserSkillSchema = z
  .object({
    body: z.string().trim().min(1).max(40_000),
    category: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().min(1).max(400),
    name: z.string().trim().min(1).max(80),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  })
  .strict();

export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequestSchema>;
export type ApprovalDecisionResponse = z.infer<typeof ApprovalDecisionResponseSchema>;
export type BillingCheckout = z.infer<typeof BillingCheckoutSchema>;
export type BillingCancel = z.infer<typeof BillingCancelSchema>;
export type BillingCancellationReason = z.infer<typeof BillingCancellationReasonSchema>;
export type BillingCatalogResponse = z.infer<typeof BillingCatalogResponseSchema>;
export type BillingStateResponse = z.infer<typeof BillingStateResponseSchema>;
export type BillingSubscriptionActionResponse = z.infer<
  typeof BillingSubscriptionActionResponseSchema
>;
export type BillingTier = z.infer<typeof BillingTierSchema>;
export type BillingUrlResponse = z.infer<typeof BillingUrlResponseSchema>;
export type PaidBillingTier = z.infer<typeof PaidBillingTierSchema>;
export type PlanCatalogResponse = z.infer<typeof PlanCatalogResponseSchema>;
export type PlanSummary = z.infer<typeof PlanSummarySchema>;
export type SandboxUsageSummaryResponse = z.infer<typeof SandboxUsageSummaryResponseSchema>;
export type SandboxUsageWarnLevel = z.infer<typeof SandboxUsageWarnLevelSchema>;
export type UsageRunPoint = z.infer<typeof UsageRunPointSchema>;
export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type CreateRun = z.infer<typeof CreateRunSchema>;
export type CreateThread = z.infer<typeof CreateThreadSchema>;
export type GreetingResponse = z.infer<typeof GreetingResponseSchema>;
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type RecentThreadsQuery = z.infer<typeof RecentThreadsQuerySchema>;
export type RecentThreadsResponse = z.infer<typeof RecentThreadsResponseSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SearchResultProject = z.infer<typeof SearchResultProjectSchema>;
export type SearchResultThread = z.infer<typeof SearchResultThreadSchema>;
export type AgentSummary = z.infer<typeof AgentSummarySchema>;
export type Integration = z.infer<typeof IntegrationSchema>;
export type IntegrationCatalog = z.infer<typeof IntegrationCatalogSchema>;
export type IntegrationConnectResponse = z.infer<typeof IntegrationConnectResponseSchema>;
export type IntegrationName = z.infer<typeof IntegrationNameSchema>;
export type ToolkitAction = z.infer<typeof ToolkitActionSchema>;
export type ToolkitActionsResponse = z.infer<typeof ToolkitActionsResponseSchema>;
export type ToolkitCatalogEntry = z.infer<typeof ToolkitCatalogEntrySchema>;
export type ToolkitCategory = z.infer<typeof ToolkitCategorySchema>;
export type LimitsSnapshot = z.infer<typeof LimitsSnapshotSchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type ProviderKeySummary = z.infer<typeof ProviderKeySummarySchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type ToolSummary = z.infer<typeof ToolSummarySchema>;
export type UIMessageRecord = z.infer<typeof UIMessageRecordSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
export type UpdateThread = z.infer<typeof UpdateThreadSchema>;
export type UpsertProviderKey = z.infer<typeof UpsertProviderKeySchema>;
export type SandboxConsoleLine = z.infer<typeof SandboxConsoleLineSchema>;
export type SandboxConsoleProcess = z.infer<typeof SandboxConsoleProcessSchema>;
export type SandboxConsoleQuery = z.infer<typeof SandboxConsoleQuerySchema>;
export type SandboxConsoleSnapshot = z.infer<typeof SandboxConsoleSnapshotSchema>;
export type SandboxFile = z.infer<typeof SandboxFileSchema>;
export type SandboxFileEntry = z.infer<typeof SandboxFileEntrySchema>;
export type SandboxFileList = z.infer<typeof SandboxFileListSchema>;
export type SandboxFilePath = z.infer<typeof SandboxFilePathSchema>;
export type SandboxFilePreview = z.infer<typeof SandboxFilePreviewSchema>;
export type SandboxFileWrite = z.infer<typeof SandboxFileWriteSchema>;
export type SandboxIdeSession = z.infer<typeof SandboxIdeSessionSchema>;
export type SandboxPreviewWake = z.infer<typeof SandboxPreviewWakeSchema>;
export type SandboxPreviewStatus = z.infer<typeof SandboxPreviewStatusSchema>;
export type SandboxTerminalCommand = z.infer<typeof SandboxTerminalCommandSchema>;
export type SandboxTerminalContext = z.infer<typeof SandboxTerminalContextSchema>;
export type SandboxTerminalResult = z.infer<typeof SandboxTerminalResultSchema>;
export type UpdateSandboxFile = z.infer<typeof UpdateSandboxFileSchema>;
export type UpdateSandboxPathFile = z.infer<typeof UpdateSandboxPathFileSchema>;
export type UsageDailyQuery = z.infer<typeof UsageDailyQuerySchema>;
export type UsageDailyTotal = z.infer<typeof UsageDailyTotalSchema>;
export type UsageDailyTotalsResponse = z.infer<typeof UsageDailyTotalsResponseSchema>;
export type CreateUserSkill = z.infer<typeof CreateUserSkillSchema>;
export type UserSkill = z.infer<typeof UserSkillSchema>;
export type UserSkillsResponse = z.infer<typeof UserSkillsResponseSchema>;

// ---------------------------------------------------------------------------
// Automations (bud-parity: scheduled + event-triggered agent runs)
// ---------------------------------------------------------------------------

export const AutomationKindSchema = z.enum(["scheduled", "event"]);
export const AutomationStatusSchema = z.enum(["running", "paused"]);

export const AutomationDeliveryChannelSchema = z
  .object({
    type: z.enum(["slack", "notion", "email"]),
    target: z.string().trim().min(1).max(400),
  })
  .strict();

/** Permissive 5-field cron (UTC). Runtime expansion validates further. */
const CronExpressionSchema = z
  .string()
  .trim()
  .regex(/^(\S+\s+){4}\S+$/, "Expected a 5-field cron expression");

export const CreateAutomationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: AutomationKindSchema,
    prompt: z.string().trim().min(1).max(20_000),
    model: z.string().trim().min(1).max(200).optional(),
    projectId: z.string().uuid().optional(),
    schedule: CronExpressionSchema.optional(),
    triggerToolkit: z.string().trim().min(1).max(120).optional(),
    triggerSlug: z.string().trim().min(1).max(200).optional(),
    deliveryChannels: z.array(AutomationDeliveryChannelSchema).max(10).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "scheduled" && !value.schedule) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "schedule is required for scheduled automations",
        path: ["schedule"],
      });
    }
    if (value.kind === "event" && (!value.triggerToolkit || !value.triggerSlug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "triggerToolkit and triggerSlug are required for event automations",
        path: ["triggerSlug"],
      });
    }
  });

export const UpdateAutomationSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    status: AutomationStatusSchema.optional(),
    prompt: z.string().trim().min(1).max(20_000).optional(),
    model: z.string().trim().min(1).max(200).nullable().optional(),
    schedule: CronExpressionSchema.optional(),
    deliveryChannels: z.array(AutomationDeliveryChannelSchema).max(10).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one automation field is required.",
  });

export const AutomationSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    status: AutomationStatusSchema,
    kind: AutomationKindSchema,
    prompt: z.string(),
    model: z.string().nullable(),
    projectId: z.string().uuid().nullable(),
    schedule: z.string().nullable(),
    triggerToolkit: z.string().nullable(),
    triggerSlug: z.string().nullable(),
    deliveryChannels: z.array(AutomationDeliveryChannelSchema),
    nextRunAt: z.string().datetime().nullable(),
    lastRunAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const AutomationDeliveryResultSchema = z
  .object({
    type: z.enum(["slack", "notion", "email"]),
    target: z.string(),
    status: z.enum(["pending", "delivered", "failed"]),
    error: z.string().optional(),
  })
  .strict();

export const AutomationRunSummarySchema = z
  .object({
    id: z.string().uuid(),
    automationId: z.string().uuid(),
    threadId: z.string().uuid().nullable(),
    status: z.enum(["running", "succeeded", "failed", "skipped"]),
    summary: z.string().nullable(),
    error: z.string().nullable(),
    deliveries: z.array(AutomationDeliveryResultSchema),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .strict();

export const AutomationListResponseSchema = z
  .object({ automations: z.array(AutomationSummarySchema) })
  .strict();

export const AutomationRunsResponseSchema = z
  .object({ runs: z.array(AutomationRunSummarySchema) })
  .strict();

export type AutomationKind = z.infer<typeof AutomationKindSchema>;
export type AutomationStatus = z.infer<typeof AutomationStatusSchema>;
export type AutomationDeliveryChannel = z.infer<typeof AutomationDeliveryChannelSchema>;
export type CreateAutomation = z.infer<typeof CreateAutomationSchema>;
export type UpdateAutomation = z.infer<typeof UpdateAutomationSchema>;
export type AutomationSummary = z.infer<typeof AutomationSummarySchema>;
export type AutomationRunSummary = z.infer<typeof AutomationRunSummarySchema>;
export type AutomationListResponse = z.infer<typeof AutomationListResponseSchema>;
export type AutomationRunsResponse = z.infer<typeof AutomationRunsResponseSchema>;

// --- Account (GET/PATCH /v1/me) ---

export const MeResponseSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  })
  .strict();

export const UpdateMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one account field is required.",
  });

export type MeResponse = z.infer<typeof MeResponseSchema>;
export type UpdateMe = z.infer<typeof UpdateMeSchema>;
