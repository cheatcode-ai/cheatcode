import type { ApprovalBroker, ApprovalRequestInput, RunDecision } from "@cheatcode/agent-core";
import {
  type AnalyticsBindings,
  APIError,
  createLogger,
  emitUserEvent,
} from "@cheatcode/observability";
import {
  ApprovalDecisionDataSchema,
  type ApprovalDecisionResponse,
  ApprovalRequestDataSchema,
  type ModelFallbackData,
  ModelFallbackDataSchema,
} from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import { z } from "zod";
import { nextAgentRunAlarm } from "./agent-run-retention";
import { deleteRunStateValues, getRunStateValue, setRunStateValue } from "./agent-run-storage";

/** Tool-approval default-deny window (run-control §2.5: 5 minutes). */
export const TOOL_APPROVAL_TIMEOUT_MS = 5 * 60_000;
/** Model-fallback auto-allow window (run-control §2.5: 120 seconds). */
export const MODEL_FALLBACK_DECISION_TIMEOUT_MS = 120_000;
const APPROVAL_SUMMARY_MAX = 400;
const PENDING_APPROVAL_KEY = "pending_approval";
const APPROVAL_DECISION_PREFIX = "approval_decision:";

const PendingApprovalSchema = z
  .object({
    approvalId: z.string().uuid(),
    expiresAt: z.number().int(),
    kind: z.enum(["tool-approval", "model-fallback"]),
    requestedAt: z.number().int(),
    summary: z.string().min(1).max(APPROVAL_SUMMARY_MAX),
    timeoutDecision: z.enum(["allow", "deny"]),
    toolName: z.string().min(1).optional(),
  })
  .strict();
export type PendingApproval = z.infer<typeof PendingApprovalSchema>;

const ApprovalDecisionRecordSchema = z
  .object({
    approvalId: z.string().uuid(),
    decidedAt: z.number().int(),
    decidedBy: z.enum(["user", "timeout", "cancel"]),
    decision: z.enum(["allow", "deny"]),
    reason: z.string().max(500).optional(),
  })
  .strict();
type ApprovalDecisionRecord = z.infer<typeof ApprovalDecisionRecordSchema>;

/** Body of the DO `/approval` endpoint (run-control §5.2). */
export const ApprovalDecisionInputSchema = z
  .object({
    approvalId: z.string().uuid(),
    decision: z.enum(["allow", "deny"]),
    reason: z.string().trim().min(1).max(500).optional(),
    userId: z.string().uuid(),
  })
  .strict();
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInputSchema>;

export interface RunIdentity {
  runId: string;
  threadId: string;
  userId: string;
}

export interface RunApprovalControllerDeps {
  append: (chunk: UIMessageChunk, options?: { allowAfterCancelRequest?: boolean }) => Promise<void>;
  armAlarm: () => Promise<void>;
  ctx: DurableObjectState;
  currentStatus: () => string | undefined;
  env: AnalyticsBindings;
  finalizeUnrecoverable: () => Promise<void>;
  identity: () => RunIdentity | null;
  isCanceled: () => boolean;
  setRunStatus: (status: "paused" | "running") => Promise<void>;
}

interface ResolveParams {
  approvalId: string;
  decidedBy: ApprovalDecisionRecord["decidedBy"];
  decision: ApprovalDecisionRecord["decision"];
  kind: PendingApproval["kind"];
  reason?: string;
}

/**
 * Per-run approval controller (run-control §5.1/§5.2). Owns the in-memory
 * resolver map plus the pause/resolve/alarm/cancel/orphan state machine. The DO
 * wires thin closures into {@link RunApprovalControllerDeps} so the heavy logic
 * lives here, keeping `agent-run.ts` under the line cap.
 */
export class RunApprovalController {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly resolvers = new Map<string, (decision: RunDecision) => void>();

  public constructor(private readonly deps: RunApprovalControllerDeps) {}

  public hasPendingDecision(): boolean {
    return this.resolvers.size > 0;
  }

  public createBroker(): ApprovalBroker {
    return { requestDecision: (input) => this.requestDecision(input) };
  }

  /** Serializes concurrent gated calls onto a single pending slot (§5.1). */
  private requestDecision(input: ApprovalRequestInput): Promise<RunDecision> {
    const result = this.chain.then(() => this.beginRequest(input));
    this.chain = result.catch(() => undefined);
    return result;
  }

  private async beginRequest(input: ApprovalRequestInput): Promise<RunDecision> {
    const identity = this.deps.identity();
    if (this.deps.isCanceled() || !identity) {
      return { decidedBy: "cancel", decision: "deny" };
    }
    const pending = buildPending(input);
    return new Promise<RunDecision>((resolve, reject) => {
      this.resolvers.set(pending.approvalId, resolve);
      this.openApproval(pending, identity).catch((error: unknown) => {
        this.resolvers.delete(pending.approvalId);
        reject(error instanceof Error ? error : new Error("Approval setup failed."));
      });
    });
  }

  private async openApproval(pending: PendingApproval, identity: RunIdentity): Promise<void> {
    savePendingApproval(this.deps.ctx, pending);
    await this.deps.setRunStatus("paused");
    await this.deps.append(approvalRequestChunk(pending, identity.runId));
    await this.deps.armAlarm();
    this.logRequested(pending, identity);
  }

  /** POST `/approval` path (decidedBy: "user"); idempotent on replays (§5.1). */
  public async applyDecision(
    input: Pick<ApprovalDecisionInput, "approvalId" | "decision"> & { reason?: string },
  ): Promise<ApprovalDecisionResponse> {
    const recorded = readApprovalDecision(this.deps.ctx, input.approvalId);
    if (recorded) {
      if (recorded.decision !== input.decision) {
        throw conflictDecisionError();
      }
      return this.decisionResponse(recorded);
    }
    const pending = readPendingApproval(this.deps.ctx);
    if (!pending || pending.approvalId !== input.approvalId) {
      throw unknownApprovalError();
    }
    if (!this.resolvers.has(input.approvalId)) {
      await this.finalizeOrphaned(pending);
      throw orphanedApprovalError();
    }
    const record = await this.resolveInternal({
      approvalId: input.approvalId,
      decidedBy: "user",
      decision: input.decision,
      kind: pending.kind,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    return this.decisionResponse(record);
  }

  /** Alarm path (§5.1): apply the timeout decision, or finalize if orphaned. */
  public async handleAlarmIfDue(): Promise<boolean> {
    const pending = readPendingApproval(this.deps.ctx);
    if (!pending) {
      return false;
    }
    if (Date.now() < pending.expiresAt) {
      await this.deps.armAlarm();
      return true;
    }
    if (!this.resolvers.has(pending.approvalId)) {
      await this.finalizeOrphaned(pending);
      return true;
    }
    await this.resolveInternal({
      approvalId: pending.approvalId,
      decidedBy: "timeout",
      decision: pending.timeoutDecision,
      kind: pending.kind,
    });
    return true;
  }

  /** Cancel path (§5.1): resolve any pending decision as deny+cancel. */
  public async cancelPending(): Promise<boolean> {
    const pending = readPendingApproval(this.deps.ctx);
    if (!pending) {
      return false;
    }
    await this.resolveInternal({
      approvalId: pending.approvalId,
      decidedBy: "cancel",
      decision: "deny",
      kind: pending.kind,
    });
    return true;
  }

  private async resolveInternal(params: ResolveParams): Promise<ApprovalDecisionRecord> {
    const identity = this.deps.identity();
    const runId = identity?.runId ?? getRunStateValue(this.deps.ctx, "run_id") ?? "";
    const record: ApprovalDecisionRecord = {
      approvalId: params.approvalId,
      decidedAt: Date.now(),
      decidedBy: params.decidedBy,
      decision: params.decision,
      ...(params.reason ? { reason: params.reason } : {}),
    };
    recordApprovalDecision(this.deps.ctx, record);
    await this.deps.append(approvalDecisionChunk(record, runId), {
      allowAfterCancelRequest: params.decidedBy === "cancel",
    });
    clearPendingApproval(this.deps.ctx);
    if (params.decidedBy !== "cancel") {
      await this.deps.setRunStatus("running");
    }
    await this.deps.armAlarm();
    this.releaseResolver(record);
    this.logDecided(record, params.kind, identity);
    return record;
  }

  private releaseResolver(record: ApprovalDecisionRecord): void {
    const resolver = this.resolvers.get(record.approvalId);
    if (!resolver) {
      return;
    }
    this.resolvers.delete(record.approvalId);
    resolver({
      decidedBy: record.decidedBy,
      decision: record.decision,
      ...(record.reason ? { reason: record.reason } : {}),
    });
  }

  private async finalizeOrphaned(pending: PendingApproval): Promise<void> {
    const identity = this.deps.identity();
    if (identity) {
      this.logger(identity).error("tool_approval_unrecoverable", {
        approvalId: pending.approvalId,
      });
    }
    clearPendingApproval(this.deps.ctx);
    await this.deps.finalizeUnrecoverable();
  }

  private decisionResponse(record: ApprovalDecisionRecord): ApprovalDecisionResponse {
    return {
      approvalId: record.approvalId,
      decidedBy: record.decidedBy,
      decision: record.decision,
      ok: true,
      runStatus: this.currentRunStatus(),
    };
  }

  private currentRunStatus(): ApprovalDecisionResponse["runStatus"] {
    const status = this.deps.currentStatus();
    if (
      status === "running" ||
      status === "paused" ||
      status === "completed" ||
      status === "failed" ||
      status === "canceled"
    ) {
      return status;
    }
    return "running";
  }

  private logRequested(pending: PendingApproval, identity: RunIdentity): void {
    const logger = this.logger(identity);
    if (pending.kind === "tool-approval") {
      logger.info("tool_approval_requested", {
        approvalId: pending.approvalId,
        expiresAt: pending.expiresAt,
        ...(pending.toolName ? { toolName: pending.toolName } : {}),
      });
      this.emit("tool_approval_requested", identity, pending.toolName);
      return;
    }
    logger.warn("llm_provider_fallback_offered", {
      approvalId: pending.approvalId,
      expiresAt: pending.expiresAt,
    });
    this.emit("model_fallback_offered", identity, undefined);
  }

  private logDecided(
    record: ApprovalDecisionRecord,
    kind: PendingApproval["kind"],
    identity: RunIdentity | null,
  ): void {
    if (!identity) {
      return;
    }
    const logger = this.logger(identity);
    if (kind === "tool-approval") {
      logger.info("tool_approval_decided", {
        approvalId: record.approvalId,
        decidedBy: record.decidedBy,
        decision: record.decision,
      });
      this.emit("tool_approval_decided", identity, undefined);
      return;
    }
    logger.warn("llm_provider_fallback_decided", {
      approvalId: record.approvalId,
      decidedBy: record.decidedBy,
      decision: record.decision,
    });
    this.emit("model_fallback_decided", identity, undefined);
  }

  private emit(eventName: string, identity: RunIdentity, toolName: string | undefined): void {
    emitUserEvent(this.deps.env, {
      eventName,
      runId: identity.runId,
      userId: identity.userId,
      ...(toolName ? { toolName } : {}),
    });
  }

  private logger(identity: RunIdentity): ReturnType<typeof createLogger> {
    return createLogger({
      runId: identity.runId,
      threadId: identity.threadId,
      userId: identity.userId,
    });
  }
}

/**
 * Emits the informational `data-model-fallback` part, then opens the interactive
 * fallback pause (run-control §5.5). Returns the user/timeout decision.
 */
export async function offerModelFallback(params: {
  append: (chunk: UIMessageChunk) => Promise<void>;
  broker: ApprovalBroker;
  fromModel: string;
  reason: ModelFallbackData["reason"];
  toModel: string;
}): Promise<RunDecision> {
  await params.append(modelFallbackChunk(params.fromModel, params.toModel, params.reason));
  return params.broker.requestDecision({
    kind: "model-fallback",
    summary: `Fall back from ${params.fromModel} to ${params.toModel} (${params.reason}).`.slice(
      0,
      APPROVAL_SUMMARY_MAX,
    ),
    timeoutDecision: "allow",
    timeoutMs: MODEL_FALLBACK_DECISION_TIMEOUT_MS,
  });
}

/** Re-arms the DO alarm to the earliest of retention vs. the approval deadline (§5.1). */
export async function armAgentRunAlarm(ctx: DurableObjectState): Promise<void> {
  const pending = readPendingApproval(ctx);
  const retentionAlarm = nextAgentRunAlarm(Date.now());
  const target = pending ? Math.min(pending.expiresAt, retentionAlarm) : retentionAlarm;
  await ctx.storage.setAlarm(target);
}

/** Pending-approval shape for the `GET /runs/status` snapshot (run-control §4.2). */
export function pendingApprovalSnapshot(ctx: DurableObjectState): PendingApproval | undefined {
  return readPendingApproval(ctx) ?? undefined;
}

export function savePendingApproval(ctx: DurableObjectState, pending: PendingApproval): void {
  setRunStateValue(ctx, PENDING_APPROVAL_KEY, JSON.stringify(pending));
}

export function readPendingApproval(ctx: DurableObjectState): PendingApproval | null {
  const raw = getRunStateValue(ctx, PENDING_APPROVAL_KEY);
  if (!raw) {
    return null;
  }
  const parsed = PendingApprovalSchema.safeParse(safeJsonParse(raw));
  return parsed.success ? parsed.data : null;
}

export function clearPendingApproval(ctx: DurableObjectState): void {
  deleteRunStateValues(ctx, [PENDING_APPROVAL_KEY]);
}

function recordApprovalDecision(ctx: DurableObjectState, record: ApprovalDecisionRecord): void {
  setRunStateValue(ctx, `${APPROVAL_DECISION_PREFIX}${record.approvalId}`, JSON.stringify(record));
}

function readApprovalDecision(
  ctx: DurableObjectState,
  approvalId: string,
): ApprovalDecisionRecord | null {
  const raw = getRunStateValue(ctx, `${APPROVAL_DECISION_PREFIX}${approvalId}`);
  if (!raw) {
    return null;
  }
  const parsed = ApprovalDecisionRecordSchema.safeParse(safeJsonParse(raw));
  return parsed.success ? parsed.data : null;
}

function buildPending(input: ApprovalRequestInput): PendingApproval {
  const requestedAt = Date.now();
  return {
    approvalId: crypto.randomUUID(),
    expiresAt: requestedAt + input.timeoutMs,
    kind: input.kind,
    requestedAt,
    summary: input.summary.slice(0, APPROVAL_SUMMARY_MAX),
    timeoutDecision: input.timeoutDecision,
    ...(input.toolName ? { toolName: input.toolName } : {}),
  };
}

function approvalRequestChunk(pending: PendingApproval, runId: string): UIMessageChunk {
  return {
    data: ApprovalRequestDataSchema.parse({
      approvalId: pending.approvalId,
      expiresAt: pending.expiresAt,
      kind: pending.kind,
      requestedAt: pending.requestedAt,
      runId,
      summary: pending.summary,
      timeoutDecision: pending.timeoutDecision,
      v: 1,
      ...(pending.toolName ? { toolName: pending.toolName } : {}),
    }),
    type: "data-approval-request",
  };
}

function approvalDecisionChunk(record: ApprovalDecisionRecord, runId: string): UIMessageChunk {
  return {
    data: ApprovalDecisionDataSchema.parse({
      approvalId: record.approvalId,
      decidedBy: record.decidedBy,
      decision: record.decision,
      runId,
      v: 1,
      ...(record.reason ? { reason: record.reason } : {}),
    }),
    type: "data-approval-decision",
  };
}

function modelFallbackChunk(
  fromModel: string,
  toModel: string,
  reason: ModelFallbackData["reason"],
): UIMessageChunk {
  return {
    data: ModelFallbackDataSchema.parse({ fromModel, reason, toModel, v: 1 }),
    type: "data-model-fallback",
  };
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function conflictDecisionError(): APIError {
  return new APIError(
    409,
    "conflict_state_invalid",
    "A different decision was already recorded for this approval.",
    {
      hint: "The approval was already resolved with the opposite decision.",
      retriable: false,
    },
  );
}

function unknownApprovalError(): APIError {
  return new APIError(409, "conflict_state_invalid", "Run is not awaiting this approval.", {
    hint: "The approval id is unknown or already resolved.",
    retriable: false,
  });
}

function orphanedApprovalError(): APIError {
  return new APIError(409, "conflict_state_invalid", "Run is no longer live — start a new run.", {
    hint: "The run could not recover the pending approval after a restart.",
    retriable: false,
  });
}
