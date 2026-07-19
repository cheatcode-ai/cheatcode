import { z } from "zod";
import { UserId } from "./ids";

const InternalRunIdListSchema = z
  .array(z.string().uuid())
  .max(10_000)
  .superRefine((runIds, context) => {
    if (new Set(runIds).size !== runIds.length) {
      context.addIssue({ code: "custom", message: "Run IDs must be unique." });
    }
  });
const ReleaseShaSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const DeletionFenceSchema = z.string().regex(/^[1-9]\d{12}$/u);
const DeletionGenerationSchema = z.string().datetime({ offset: true });
const ProjectWorkspaceSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const DurableObjectStorageClassSchema = z.enum([
  "AgentRun",
  "ProjectSandbox",
  "IdempotencyStore",
  "QuotaTracker",
  "RateLimiter",
  "WebhookIdempotencyStore",
]);

export type DurableObjectStorageClass = z.infer<typeof DurableObjectStorageClassSchema>;

export const DURABLE_OBJECT_STORAGE_SCHEMA_VERSIONS = {
  AgentRun: "agent-run-sqlite-v1",
  IdempotencyStore: "idempotency-store-sqlite-v1",
  ProjectSandbox: "project-sandbox-sqlite-v1",
  QuotaTracker: "quota-tracker-sqlite-v1",
  RateLimiter: "rate-limiter-sqlite-v1",
  WebhookIdempotencyStore: "webhook-idempotency-store-sqlite-v1",
} as const satisfies Record<DurableObjectStorageClass, string>;

const DurableObjectIdSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const InternalDurableObjectStorageRequestSchema = z
  .object({
    className: DurableObjectStorageClassSchema,
    mode: z.enum(["reconcile", "verify"]),
    objectId: DurableObjectIdSchema,
    releaseSha: ReleaseShaSchema,
  })
  .strict();

export type InternalDurableObjectStorageRequest = z.infer<
  typeof InternalDurableObjectStorageRequestSchema
>;

export const InternalDurableObjectStorageResponseSchema = z
  .object({
    className: DurableObjectStorageClassSchema,
    objectId: DurableObjectIdSchema,
    releaseSha: ReleaseShaSchema,
    schemaVersion: z.string().min(1),
    verified: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.schemaVersion !== DURABLE_OBJECT_STORAGE_SCHEMA_VERSIONS[value.className]) {
      context.addIssue({ code: "custom", message: "Durable Object schema version mismatch." });
    }
  });

export type InternalDurableObjectStorageResponse = z.infer<
  typeof InternalDurableObjectStorageResponseSchema
>;

export const CanonicalProjectWorkspaceSlugSchema = z
  .string()
  .min(38)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    "Workspace slug must end with its lowercase project UUID.",
  );

export const WorkspaceTransitionProjectSchema = z
  .object({
    canonicalWorkspaceSlug: CanonicalProjectWorkspaceSlugSchema,
    currentWorkspaceSlug: ProjectWorkspaceSlugSchema,
    projectId: z.string().uuid().toLowerCase(),
  })
  .strict()
  .refine(
    (project) => project.canonicalWorkspaceSlug.endsWith(`-${project.projectId}`),
    "Canonical workspace slug must belong to its project.",
  );

export type WorkspaceTransitionProject = z.infer<typeof WorkspaceTransitionProjectSchema>;

const WorkspaceTransitionProjectsSchema = z
  .array(WorkspaceTransitionProjectSchema)
  .max(10_000)
  .superRefine((projects, context) => {
    assertUniqueTransitionValues(projects, context, "projectId");
    assertUniqueTransitionValues(projects, context, "currentWorkspaceSlug");
    assertUniqueTransitionValues(projects, context, "canonicalWorkspaceSlug");
    const currentSlugs = new Set(projects.map((project) => project.currentWorkspaceSlug));
    for (const [index, project] of projects.entries()) {
      if (
        project.currentWorkspaceSlug !== project.canonicalWorkspaceSlug &&
        currentSlugs.has(project.canonicalWorkspaceSlug)
      ) {
        context.addIssue({
          code: "custom",
          message: "A canonical workspace cannot be another project's current workspace.",
          path: [index, "canonicalWorkspaceSlug"],
        });
      }
    }
  });

export const InternalAgentStateDeleteBodySchema = z.discriminatedUnion("scope", [
  z
    .object({
      deletionFence: DeletionFenceSchema,
      scope: z.literal("account"),
    })
    .strict(),
  z
    .object({
      deletedAt: DeletionGenerationSchema,
      projectId: z.string().uuid().toLowerCase(),
      scope: z.literal("project"),
      workspaceSlug: CanonicalProjectWorkspaceSlugSchema,
    })
    .strict(),
  z
    .object({
      authority: z.discriminatedUnion("kind", [
        z
          .object({
            deletionFence: DeletionFenceSchema,
            kind: z.literal("account"),
          })
          .strict(),
        z
          .object({
            deletedAt: DeletionGenerationSchema,
            kind: z.literal("project"),
            projectId: z.string().uuid().toLowerCase(),
          })
          .strict(),
        z
          .object({
            deletedAt: DeletionGenerationSchema,
            kind: z.literal("thread"),
            threadId: z.string().uuid().toLowerCase(),
          })
          .strict(),
      ]),
      runIds: InternalRunIdListSchema,
      scope: z.literal("runs"),
    })
    .strict(),
]);

export type InternalAgentStateDeleteBody = z.infer<typeof InternalAgentStateDeleteBodySchema>;

export const InternalWorkspaceReconciliationBodySchema = z
  .object({
    phase: z.enum(["prepare", "finalize"]),
    projects: WorkspaceTransitionProjectsSchema,
    releaseSha: ReleaseShaSchema,
  })
  .strict();

export type InternalWorkspaceReconciliationBody = z.infer<
  typeof InternalWorkspaceReconciliationBodySchema
>;

const SandboxSnapshotReconciliationSchema = z
  .object({
    complete: z.boolean(),
    sourceSnapshot: z.string().min(1).nullable(),
    status: z.enum(["absent", "current", "upgraded", "upgrading"]),
    targetSnapshot: z.string().min(1).max(500),
    upgradeId: z
      .string()
      .regex(/^[0-9a-f]{32}$/u)
      .nullable(),
    workspaceDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.complete === (value.status === "upgrading")) {
      context.addIssue({ code: "custom", message: "Snapshot completion and status disagree." });
    }
    if (value.status === "upgraded" && (!value.upgradeId || !value.workspaceDigest)) {
      context.addIssue({ code: "custom", message: "Completed upgrade evidence is incomplete." });
    }
    if ((value.status === "absent" || value.status === "current") && value.upgradeId) {
      context.addIssue({
        code: "custom",
        message: "Unchanged sandboxes cannot expose an upgrade.",
      });
    }
    if ((value.status === "absent" || value.status === "current") && value.workspaceDigest) {
      context.addIssue({ code: "custom", message: "Unchanged sandboxes cannot expose a digest." });
    }
    if (value.status === "absent" && value.sourceSnapshot !== null) {
      context.addIssue({ code: "custom", message: "An absent sandbox cannot expose a source." });
    }
    if (value.status === "current" && value.sourceSnapshot !== value.targetSnapshot) {
      context.addIssue({ code: "custom", message: "A current sandbox must match its target." });
    }
  });

export type SandboxSnapshotReconciliation = z.infer<typeof SandboxSnapshotReconciliationSchema>;

export const InternalWorkspaceReconciliationResponseSchema = z
  .object({
    canonicalDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    canonicalWorkspaceCount: z.number().int().nonnegative(),
    ok: z.literal(true),
    processPortReservationsRemoved: z.number().int().nonnegative(),
    processRecordsRemoved: z.number().int().nonnegative(),
    projectPortsRemoved: z.number().int().nonnegative(),
    releaseSha: ReleaseShaSchema,
    snapshot: SandboxSnapshotReconciliationSchema,
    transitionPhase: z.enum(["prepared", "completed"]),
    verified: z.literal(true),
  })
  .strict();

export type InternalWorkspaceReconciliationResponse = z.infer<
  typeof InternalWorkspaceReconciliationResponseSchema
>;

export const InternalDatabaseReadinessRequestSchema = z
  .object({ releaseSha: ReleaseShaSchema })
  .strict();

export type InternalDatabaseReadinessRequest = z.infer<
  typeof InternalDatabaseReadinessRequestSchema
>;

const DatabaseReadinessResponseBase = {
  ok: z.literal(true),
  releaseSha: ReleaseShaSchema,
  versionId: z.string().min(1).nullable(),
} as const;

export const DaytonaVolumeIdentitySchema = z
  .object({
    organizationId: z.string().uuid(),
    state: z.literal("ready"),
    volumeId: z.string().uuid(),
    volumeName: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  })
  .strict();

export type DaytonaVolumeIdentity = z.infer<typeof DaytonaVolumeIdentitySchema>;

export const ClerkInstanceIdentitySchema = z
  .object({
    environmentType: z.enum(["development", "production"]),
    instanceId: z.string().min(1).max(500),
  })
  .strict();

export const ProductionClerkInstanceIdentitySchema = ClerkInstanceIdentitySchema.extend({
  environmentType: z.literal("production"),
}).strict();

export type ClerkInstanceIdentity = z.infer<typeof ClerkInstanceIdentitySchema>;
export type ProductionClerkInstanceIdentity = z.infer<typeof ProductionClerkInstanceIdentitySchema>;

export const GatewayDatabaseReadinessResponseSchema = z
  .object({
    ...DatabaseReadinessResponseBase,
    clerk: ClerkInstanceIdentitySchema,
    databaseRole: z.literal("app_gateway"),
    worker: z.literal("gateway"),
  })
  .strict();

export const AgentDatabaseReadinessResponseSchema = z
  .object({
    ...DatabaseReadinessResponseBase,
    databaseRole: z.literal("app_agent"),
    daytona: DaytonaVolumeIdentitySchema,
    worker: z.literal("agent"),
  })
  .strict();

export const WebhooksDatabaseReadinessResponseSchema = z
  .object({
    ...DatabaseReadinessResponseBase,
    databaseRole: z.literal("app_webhooks"),
    worker: z.literal("webhooks"),
  })
  .strict();

export const InternalDatabaseReadinessResponseSchema = z.discriminatedUnion("worker", [
  GatewayDatabaseReadinessResponseSchema,
  AgentDatabaseReadinessResponseSchema,
  WebhooksDatabaseReadinessResponseSchema,
]);

export type InternalDatabaseReadinessResponse = z.infer<
  typeof InternalDatabaseReadinessResponseSchema
>;

export const GatewayDatabaseReadinessAggregateResponseSchema = z
  .object({
    ...DatabaseReadinessResponseBase,
    agent: AgentDatabaseReadinessResponseSchema,
    clerk: ClerkInstanceIdentitySchema,
    databaseRole: z.literal("app_gateway"),
    webhooks: WebhooksDatabaseReadinessResponseSchema,
    worker: z.literal("gateway"),
  })
  .strict();

export type GatewayDatabaseReadinessAggregateResponse = z.infer<
  typeof GatewayDatabaseReadinessAggregateResponseSchema
>;

export const InternalProjectDeletionRequestSchema = z
  .object({
    deletedAt: z.string().datetime({ offset: true }),
    kind: z.literal("project-deletion"),
    projectId: z.string().uuid(),
    userId: z.string().uuid(),
    workspaceSlug: z.string().min(1).max(200),
  })
  .strict();

export const InternalThreadDeletionRequestSchema = z
  .object({
    deletedAt: z.string().datetime({ offset: true }),
    kind: z.literal("thread-deletion"),
    projectId: z.string().uuid().nullable(),
    threadId: z.string().uuid(),
    userId: z.string().uuid(),
  })
  .strict();

export const InternalResourceDeletionRequestSchema = z.discriminatedUnion("kind", [
  InternalProjectDeletionRequestSchema,
  InternalThreadDeletionRequestSchema,
]);

export type InternalResourceDeletionRequest = z.infer<typeof InternalResourceDeletionRequestSchema>;

export const ResourceDeletionWorkflowPayloadSchema = z
  .object({
    continuation: z.number().int().nonnegative(),
    jobId: z.string().uuid(),
    leaseToken: z.string().uuid(),
    userId: z.string().uuid().transform(UserId),
  })
  .strict();

export type ResourceDeletionWorkflowPayload = z.infer<typeof ResourceDeletionWorkflowPayloadSchema>;

export const INTERNAL_RESOURCE_DELETION_PATH = "/internal/resource-deletions";
export const INTERNAL_DATABASE_READINESS_PATH = "/internal/release/database-readiness";
export const INTERNAL_DURABLE_OBJECT_STORAGE_PATH = "/internal/release/durable-object-storage";

export const InternalStateDeleteResponseSchema = z.object({ ok: z.literal(true) }).strict();

export type InternalStateDeleteResponse = z.infer<typeof InternalStateDeleteResponseSchema>;

export function internalUserStateDeletePath(userId: UserId): string {
  return `/internal/users/${encodeURIComponent(userId)}/delete-state`;
}

export function internalUserWorkspaceReconciliationPath(userId: UserId): string {
  return `/internal/users/${encodeURIComponent(userId)}/reconcile-workspaces`;
}

export async function canonicalWorkspaceDigest(slugs: readonly string[]): Promise<string> {
  const canonical = [...slugs].sort().join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertUniqueTransitionValues(
  projects: z.infer<typeof WorkspaceTransitionProjectSchema>[],
  context: z.RefinementCtx,
  key: keyof z.infer<typeof WorkspaceTransitionProjectSchema>,
): void {
  const values = new Set<string>();
  for (const [index, project] of projects.entries()) {
    const value = project[key];
    if (values.has(value)) {
      context.addIssue({ code: "custom", message: `${key} must be unique.`, path: [index, key] });
    }
    values.add(value);
  }
}
