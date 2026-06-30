import type { UIMessage } from "ai";
import { z } from "zod";
import type { AgentRunId, UserId } from "./ids";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "canceled";

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
    fromModel: z.string().min(1),
    toModel: z.string().min(1),
    reason: z.enum(["rate_limit", "credits", "provider_error"]),
  })
  .strict();

export type ApprovalRequestData = z.infer<typeof ApprovalRequestDataSchema>;
export type ApprovalDecisionData = z.infer<typeof ApprovalDecisionDataSchema>;
export type ModelFallbackData = z.infer<typeof ModelFallbackDataSchema>;

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
}

export type SandboxState = "cold" | "starting" | "ready" | "sleeping" | "failed";

export type CheatcodeDataParts = {
  plan: { v: 1; tasks: Task[]; parallelGroups: number[][] };
  "task-status": { v: 1; taskId: string; status: TaskStatus; error?: string };
  budget: { v: 1; tokensIn: number; tokensOut: number; usdSpent: number; capUsd: number };
  "sandbox-status": { v: 1; status: SandboxState; previewUrl?: string; expoUrl?: string };
  takeover: { v: 1; available: boolean; vncUrl?: string; resumeToken?: string };
  artifact: {
    v: 1;
    filename?: string;
    outputId: string;
    kind: "slide" | "pdf" | "image" | "video" | "audio" | "xlsx" | "docx" | "folder" | "link";
    downloadUrl: string;
    mimeType: string;
    sizeBytes?: number;
  };
  quota: { v: 1; feature: string; remaining: number; limit: number; resetAt: number };
  // `durationMs` (optional) lets the transcript render bud's "Thought for Xs"; emitted
  // by the agent worker on the final (delta:false) thinking part when available.
  thinking: { v: 1; text: string; delta: boolean; durationMs?: number };
  // One per agent tool call — renders the bud-style "Read <path> (+N more)" transcript
  // rows. `input` is the (truncated) tool arguments; the renderer maps tool name + the
  // primary arg to a human verb. Emitted on the `tool-call` chunk.
  tool: { v: 1; toolName: string; toolCallId?: string; input?: Record<string, unknown> };
  error: { v: 1; code: string; message: string; retriable: boolean };
  seq: { v: 1; seq: number };
  "approval-request": ApprovalRequestData; // → "data-approval-request"
  "approval-decision": ApprovalDecisionData; // → "data-approval-decision"
  "model-fallback": ModelFallbackData; // → "data-model-fallback"
};

export type CheatcodeMetadata = {
  runId: AgentRunId;
  modelId: string;
  userId: UserId;
};

export type CheatcodeUIMessage = UIMessage<CheatcodeMetadata, CheatcodeDataParts>;

export type UIMessagePart = {
  type: string;
  [key: string]: unknown;
};
