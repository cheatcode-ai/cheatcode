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
    title: z.string().trim().min(1).max(200).optional(),
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
    // Nullish (not required) on purpose: lets a new web bundle tolerate a gateway
    // response that predates this field while the two Workers deploy independently.
    importRepoUrl: z.string().nullable().optional(),
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
    projectId: z.string().uuid(),
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
  "fal",
  "elevenlabs",
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

export const IntegrationNameSchema = z.enum(["github", "gmail", "slack", "notion", "linear"]);

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

export const SandboxFileKeySchema = z.enum(["app-page"]);

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
    key: SandboxFileKeySchema.optional(),
    path: SandboxFilePathSchema,
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
    cwd: SandboxFilePathSchema.default("/workspace/app"),
    timeoutMs: z.number().int().positive().max(60_000).default(30_000),
  })
  .strict();

export const SandboxTerminalResultSchema = z
  .object({
    command: z.string(),
    durationMs: z.number().int().nonnegative().optional(),
    exitCode: z.number().int(),
    stderr: z.string(),
    stdout: z.string(),
    success: z.boolean(),
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
    projectId: z.string().uuid(),
    projectName: z.string(),
    updatedAt: z.string().datetime(),
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
  })
  .strict();

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
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SearchResultProject = z.infer<typeof SearchResultProjectSchema>;
export type SearchResultThread = z.infer<typeof SearchResultThreadSchema>;
export type AgentSummary = z.infer<typeof AgentSummarySchema>;
export type Integration = z.infer<typeof IntegrationSchema>;
export type IntegrationConnectResponse = z.infer<typeof IntegrationConnectResponseSchema>;
export type IntegrationName = z.infer<typeof IntegrationNameSchema>;
export type LimitsSnapshot = z.infer<typeof LimitsSnapshotSchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type ProviderKeySummary = z.infer<typeof ProviderKeySummarySchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type ToolSummary = z.infer<typeof ToolSummarySchema>;
export type UIMessageRecord = z.infer<typeof UIMessageRecordSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
export type UpsertProviderKey = z.infer<typeof UpsertProviderKeySchema>;
export type SandboxFile = z.infer<typeof SandboxFileSchema>;
export type SandboxFileEntry = z.infer<typeof SandboxFileEntrySchema>;
export type SandboxFileKey = z.infer<typeof SandboxFileKeySchema>;
export type SandboxFileList = z.infer<typeof SandboxFileListSchema>;
export type SandboxFilePath = z.infer<typeof SandboxFilePathSchema>;
export type SandboxFileWrite = z.infer<typeof SandboxFileWriteSchema>;
export type SandboxTerminalCommand = z.infer<typeof SandboxTerminalCommandSchema>;
export type SandboxTerminalResult = z.infer<typeof SandboxTerminalResultSchema>;
export type UpdateSandboxFile = z.infer<typeof UpdateSandboxFileSchema>;
export type UpdateSandboxPathFile = z.infer<typeof UpdateSandboxPathFileSchema>;
export type UsageDailyQuery = z.infer<typeof UsageDailyQuerySchema>;
export type UsageDailyTotal = z.infer<typeof UsageDailyTotalSchema>;
export type UsageDailyTotalsResponse = z.infer<typeof UsageDailyTotalsResponseSchema>;
