import type { UIMessage } from "ai";
import { z } from "zod";
import type { AgentRunId, UserId } from "./ids";
import { type LogicalModelId, LogicalModelIdSchema } from "./models";

const TaskStatusSchema = z.enum(["pending", "running", "completed", "failed", "canceled"]);
const SandboxStateSchema = z.enum(["cold", "starting", "ready", "sleeping", "failed"]);

/**
 * Tool-approval / model-fallback pause request. Emitted (persisted + replayable)
 * when the run enters the `paused` state awaiting a user Allow/Deny decision.
 * `kind` distinguishes a destructive-tool gate from an interactive model
 * fallback; `toolName` is present only for `kind: "tool-approval"`. `runId` is
 * embedded because the DO's `start` chunk does not populate UIMessage metadata,
 * and the client needs it to POST the decision to
 * `/v1/runs/{runId}/approvals/{approvalId}`. `timeoutDecision` is what the DO
 * alarm applies if no decision arrives before `expiresAt`.
 */
export const ApprovalRequestDataSchema = z
  .object({
    v: z.literal(1),
    approvalId: z.string().uuid(),
    runId: z.string().min(1),
    kind: z.enum(["tool-approval", "model-fallback"]),
    toolName: z.string().min(1).optional(),
    summary: z.string().min(1).max(400),
    requestedAt: z.number().int(),
    expiresAt: z.number().int(),
    timeoutDecision: z.enum(["allow", "deny"]),
  })
  .strict();

/**
 * Resolution of an approval request. Appended after the matching
 * `approval-request` part so the client renders the gate as resolved (buttons
 * disabled). `decidedBy` records who/what closed it: an explicit user decision,
 * the DO timeout alarm, or a run cancellation.
 */
export const ApprovalDecisionDataSchema = z
  .object({
    v: z.literal(1),
    approvalId: z.string().uuid(),
    runId: z.string().min(1),
    decision: z.enum(["allow", "deny"]),
    decidedBy: z.enum(["user", "timeout", "cancel"]),
    reason: z.string().max(500).optional(),
  })
  .strict();

/**
 * Informational model-transition part. Replaces the silent text-delta fallback
 * notice: carries the from/to model and the classified provider reason so the
 * fallback card can explain why routing changed. The interactive pause itself
 * travels via an `approval-request` part with `kind: "model-fallback"`.
 */
export const ModelFallbackDataSchema = z
  .object({
    v: z.literal(1),
    fromModel: LogicalModelIdSchema,
    toModel: LogicalModelIdSchema,
    reason: z.enum(["rate_limit", "provider_balance", "provider_error"]),
  })
  .strict();

const PlanDataSchema = z
  .object({
    v: z.literal(1),
    parallelGroups: z.array(z.array(z.number().int().nonnegative())),
    tasks: z.array(
      z
        .object({
          id: z.string().min(1),
          status: TaskStatusSchema,
          title: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

const TaskStatusDataSchema = z
  .object({
    v: z.literal(1),
    error: z.string().optional(),
    status: TaskStatusSchema,
    taskId: z.string().min(1),
  })
  .strict();

const SandboxStatusDataSchema = z
  .object({
    v: z.literal(1),
    status: SandboxStateSchema,
  })
  .strict();

const ArtifactDataSchema = z
  .object({
    v: z.literal(1),
    downloadUrl: z
      .string()
      .url()
      .refine(isSafeArtifactDownloadUrl, "Artifact download URL must use HTTPS"),
    filename: z.string().min(1).optional(),
    kind: z.enum(["slide", "pdf", "image", "video", "audio", "xlsx", "docx", "folder", "link"]),
    mimeType: z.string().min(1),
    outputId: z.string().min(1),
    sizeBytes: z.number().int().nonnegative().optional(),
  })
  .strict();

function isSafeArtifactDownloadUrl(value: string): boolean {
  const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/u, 1)[0] ?? "";
  if (!authority || authority.includes("@")) {
    return false;
  }
  if (value.startsWith("https://")) {
    return true;
  }
  return /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/u.test(value);
}

const ThinkingDataSchema = z
  .object({
    v: z.literal(1),
    delta: z.boolean(),
    durationMs: z.number().finite().nonnegative().optional(),
    text: z.string(),
  })
  .strict();

const ToolDataSchema = z
  .object({
    v: z.literal(1),
    input: z.record(z.string(), z.unknown()).optional(),
    toolCallId: z.string().min(1).optional(),
    toolName: z.string().min(1),
  })
  .strict();

const ErrorDataSchema = z
  .object({
    v: z.literal(1),
    code: z.string().min(1),
    message: z.string(),
    retriable: z.boolean(),
  })
  .strict();

const SeqDataSchema = z
  .object({
    v: z.literal(1),
    seq: z.number().int().nonnegative(),
  })
  .strict();

export const CHEATCODE_DATA_SCHEMAS = {
  "approval-decision": ApprovalDecisionDataSchema,
  "approval-request": ApprovalRequestDataSchema,
  artifact: ArtifactDataSchema,
  error: ErrorDataSchema,
  "model-fallback": ModelFallbackDataSchema,
  plan: PlanDataSchema,
  "sandbox-status": SandboxStatusDataSchema,
  seq: SeqDataSchema,
  "task-status": TaskStatusDataSchema,
  thinking: ThinkingDataSchema,
  tool: ToolDataSchema,
} as const;

export type ApprovalRequestData = z.infer<typeof ApprovalRequestDataSchema>;
export type ApprovalDecisionData = z.infer<typeof ApprovalDecisionDataSchema>;
export type ModelFallbackData = z.infer<typeof ModelFallbackDataSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type SandboxState = z.infer<typeof SandboxStateSchema>;

type CheatcodeDataParts = {
  [DataPart in keyof typeof CHEATCODE_DATA_SCHEMAS]: z.infer<
    (typeof CHEATCODE_DATA_SCHEMAS)[DataPart]
  >;
};

type CheatcodeMetadata = {
  runId: AgentRunId;
  modelId: LogicalModelId;
  userId: UserId;
};

export type CheatcodeUIMessage = UIMessage<CheatcodeMetadata, CheatcodeDataParts>;

export type UIMessagePart = {
  type: string;
  [key: string]: unknown;
};
