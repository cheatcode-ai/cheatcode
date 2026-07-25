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
export const CanonicalProjectWorkspaceSlugSchema = z
  .string()
  .min(38)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    "Workspace slug must end with its lowercase project UUID.",
  );

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

export const InternalStateDeleteResponseSchema = z.object({ ok: z.literal(true) }).strict();

export type InternalStateDeleteResponse = z.infer<typeof InternalStateDeleteResponseSchema>;

export function internalUserStateDeletePath(userId: UserId): string {
  return `/internal/users/${encodeURIComponent(userId)}/delete-state`;
}
