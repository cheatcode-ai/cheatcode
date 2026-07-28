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
const DeletionFenceSchema = z.string().regex(/^[1-9]\d{12}$/u);
const DeletionGenerationSchema = z.string().datetime({ offset: true });
const CanonicalProjectWorkspaceSlugSchema = z
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

export const InternalAgentStateDeleteRequestSchema = z
  .object({
    body: InternalAgentStateDeleteBodySchema,
    userId: z.string().uuid().transform(UserId),
  })
  .strict();

export type InternalAgentStateDeleteRequest = z.infer<typeof InternalAgentStateDeleteRequestSchema>;

const InternalProjectDeletionRequestSchema = z
  .object({
    deletedAt: z.string().datetime({ offset: true }),
    kind: z.literal("project-deletion"),
    projectId: z.string().uuid(),
    userId: z.string().uuid(),
    workspaceSlug: z.string().min(1).max(200),
  })
  .strict();

const InternalThreadDeletionRequestSchema = z
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

export const InternalStateDeleteResponseSchema = z.object({ ok: z.literal(true) }).strict();

export type InternalStateDeleteResponse = z.infer<typeof InternalStateDeleteResponseSchema>;

const InternalServiceFailureSchema = z
  .object({
    ok: z.literal(false),
    retriable: z.boolean(),
    status: z.number().int().min(400).max(599),
  })
  .strict();

export const AgentLifecycleServiceResultSchema = z.discriminatedUnion("ok", [
  InternalStateDeleteResponseSchema,
  InternalServiceFailureSchema,
]);

export type AgentLifecycleServiceResult = z.infer<typeof AgentLifecycleServiceResultSchema>;

export const ResourceDeletionServiceResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      jobId: z.string().uuid().nullable(),
      ok: z.literal(true),
    })
    .strict(),
  InternalServiceFailureSchema,
]);

export type ResourceDeletionServiceResult = z.infer<typeof ResourceDeletionServiceResultSchema>;

export interface AgentLifecycleServiceBinding {
  deleteUserState(input: InternalAgentStateDeleteRequest): Promise<AgentLifecycleServiceResult>;
}

export interface ResourceDeletionServiceBinding {
  enqueueResourceDeletion(
    input: InternalResourceDeletionRequest,
  ): Promise<ResourceDeletionServiceResult>;
}
