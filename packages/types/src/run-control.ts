import { z } from "zod";
import { LogicalModelIdSchema } from "./models";

/** Body of `POST /v1/runs/:runId/approvals/:approvalId`. */
export const ApprovalDecisionRequestSchema = z
  .object({
    decision: z.enum(["allow", "deny"]),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

/** Resolution echoed by the approval decision route. */
export const ApprovalDecisionResponseSchema = z
  .object({
    approvalId: z.string().uuid(),
    decidedBy: z.enum(["user", "timeout", "cancel"]),
    decision: z.enum(["allow", "deny"]),
    ok: z.literal(true),
    runStatus: z.enum(["running", "paused", "completed", "failed", "canceled"]),
  })
  .strict();

export const RunStatusSnapshotSchema = z
  .object({
    completedAt: z.number().int().nullable(),
    createdAt: z.number().int(),
    lastSeq: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    modelId: LogicalModelIdSchema,
    ok: z.literal(true),
    pendingApproval: z
      .object({
        approvalId: z.string().uuid(),
        expiresAt: z.number().int(),
        kind: z.enum(["tool-approval", "model-fallback"]),
        requestedAt: z.number().int(),
        summary: z.string(),
        timeoutDecision: z.enum(["allow", "deny"]),
        toolName: z.string().optional(),
      })
      .strict()
      .optional(),
    runId: z.string().min(1),
    startedAt: z.number().int().nullable(),
    status: z.enum(["idle", "running", "paused", "completed", "failed", "canceled"]),
    summary: z.string(),
  })
  .strict();

export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequestSchema>;
export type ApprovalDecisionResponse = z.infer<typeof ApprovalDecisionResponseSchema>;
