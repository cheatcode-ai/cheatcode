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
  type LogicalModelId,
  type ModelFallbackData,
  ModelFallbackDataSchema,
} from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import { z } from "zod";
import { pendingAssistantMessageRetryAt } from "./agent-run-message-persistence";
import { nextAgentRunAlarm } from "./agent-run-retention";
import { pendingStatusRetryAt } from "./agent-run-status-persistence";
import { deleteRunStateValues, getRunStateValue, setRunStateValue } from "./agent-run-storage";

/** Model-fallback auto-allow window. */
const MODEL_FALLBACK_DECISION_TIMEOUT_MS = 120_000;
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

/** Body of the DO `/approval` endpoint. */
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
 * Per-run approval controller. Owns the in-memory resolver map plus the
 * pause/resolve/alarm/cancel/orphan state machine. The DO wires thin closures
 * into {@link RunApprovalControllerDeps} so the heavy logic lives here.
 */
export class RunApprovalController {
  private requestChain: Promise<unknown> = Promise.resolve();
  private readonly resolvers = new Map<string, (decision: RunDecision) => void>();
  private settlementChain: Promise<unknown> = Promise.resolve();

  public constructor(private readonly deps: RunApprovalControllerDeps) {}

  public hasPendingDecision(): boolean {
    return this.resolvers.size > 0;
  }

  public createBroker(): ApprovalBroker {
    return { requestDecision: (input) => this.requestDecision(input) };
  }

  /** Serializes concurrent gated calls onto a single pending slot. */
  private requestDecision(input: ApprovalRequestInput): Promise<RunDecision> {
    const result = this.requestChain.then(() => this.beginRequest(input));
    this.requestChain = result.catch(() => undefined);
    return result;
  }

  private async beginRequest(input: ApprovalRequestInput): Promise<RunDecision> {
    const pending = buildPending(input);
    let resolveDecision!: (decision: RunDecision) => void;
    const decision = new Promise<RunDecision>((resolve) => {
      resolveDecision = resolve;
    });
    const opened = await this.serializeSettlement(() => this.openRequest(pending, resolveDecision));
    return opened ? decision : { decidedBy: "cancel", decision: "deny" };
  }

  private async openRequest(
    pending: PendingApproval,
    resolveDecision: (decision: RunDecision) => void,
  ): Promise<boolean> {
    const identity = this.deps.identity();
    if (this.deps.isCanceled() || !identity) {
      return false;
    }
    this.resolvers.set(pending.approvalId, resolveDecision);
    try {
      await this.openApproval(pending, identity);
    } catch (error) {
      await this.rollbackOpenFailure(pending, identity);
      throw error instanceof Error ? error : new Error("Approval setup failed.");
    }
    return true;
  }

  private async rollbackOpenFailure(
    pending: PendingApproval,
    identity: RunIdentity,
  ): Promise<void> {
    this.resolvers.delete(pending.approvalId);
    try {
      clearPendingApproval(this.deps.ctx);
    } catch (error) {
      this.logger(identity).error("approval_setup_cleanup_failed", {
        approvalId: pending.approvalId,
        error,
      });
    }
    if (!this.deps.isCanceled()) {
      await this.deps.setRunStatus("running").catch(() => undefined);
    }
    await this.deps.armAlarm().catch(() => undefined);
  }

  private async openApproval(pending: PendingApproval, identity: RunIdentity): Promise<void> {
    savePendingApproval(this.deps.ctx, pending);
    await this.deps.setRunStatus("paused");
    await this.deps.append(approvalRequestChunk(pending, identity.runId));
    await this.deps.armAlarm();
    this.logRequested(pending, identity);
  }

  /** POST `/approval` path (decidedBy: "user"); idempotent on replays. */
  public applyDecision(
    input: Pick<ApprovalDecisionInput, "approvalId" | "decision"> & { reason?: string },
  ): Promise<ApprovalDecisionResponse> {
    return this.serializeSettlement(() => this.applyDecisionInternal(input));
  }

  private async applyDecisionInternal(
    input: Pick<ApprovalDecisionInput, "approvalId" | "decision"> & { reason?: string },
  ): Promise<ApprovalDecisionResponse> {
    const recorded = readApprovalDecision(this.deps.ctx, input.approvalId);
    if (recorded) {
      return this.decisionResponseForInput(recorded, input.decision);
    }
    const pending = readPendingApproval(this.deps.ctx);
    if (!pending || pending.approvalId !== input.approvalId) {
      throw unknownApprovalError();
    }
    if (this.deps.isCanceled()) {
      const record = await this.resolveCanceled(pending);
      return this.decisionResponseForInput(record, input.decision);
    }
    if (!this.resolvers.has(input.approvalId)) {
      await this.finalizeOrphaned(pending);
      throw orphanedApprovalError();
    }
    const isExpired = Date.now() >= pending.expiresAt;
    const record = await this.resolveInternal(
      isExpired
        ? {
            approvalId: input.approvalId,
            decidedBy: "timeout",
            decision: pending.timeoutDecision,
            kind: pending.kind,
          }
        : {
            approvalId: input.approvalId,
            decidedBy: "user",
            decision: input.decision,
            kind: pending.kind,
            ...(input.reason ? { reason: input.reason } : {}),
          },
    );
    return this.decisionResponseForInput(record, input.decision);
  }

  /** Alarm path: apply the timeout decision, or finalize if orphaned. */
  public handleAlarmIfDue(): Promise<boolean> {
    return this.serializeSettlement(() => this.handleAlarmIfDueInternal());
  }

  private async handleAlarmIfDueInternal(): Promise<boolean> {
    const pending = readPendingApproval(this.deps.ctx);
    if (!pending) {
      return false;
    }
    if (this.deps.isCanceled()) {
      await this.resolveCanceled(pending);
      return true;
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

  /** Cancel path: resolve any pending decision as deny+cancel. */
  public cancelPending(): Promise<boolean> {
    return this.serializeSettlement(() => this.cancelPendingInternal());
  }

  private async cancelPendingInternal(): Promise<boolean> {
    const pending = readPendingApproval(this.deps.ctx);
    if (!pending) {
      return false;
    }
    await this.resolveCanceled(pending);
    return true;
  }

  private resolveCanceled(pending: PendingApproval): Promise<ApprovalDecisionRecord> {
    return this.resolveInternal({
      approvalId: pending.approvalId,
      decidedBy: "cancel",
      decision: "deny",
      kind: pending.kind,
    });
  }

  private serializeSettlement<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.settlementChain.then(operation);
    this.settlementChain = result.catch(() => undefined);
    return result;
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
    await this.settleDecisionSideEffect(record, identity, "append", () =>
      this.deps.append(approvalDecisionChunk(record, runId), {
        allowAfterCancelRequest: params.decidedBy === "cancel",
      }),
    );
    await this.settleDecisionSideEffect(record, identity, "clear_pending", async () => {
      clearPendingApproval(this.deps.ctx);
    });
    if (params.decidedBy !== "cancel") {
      await this.settleDecisionSideEffect(record, identity, "resume_run", () =>
        this.deps.setRunStatus("running"),
      );
    }
    await this.settleDecisionSideEffect(record, identity, "arm_alarm", () => this.deps.armAlarm());
    this.releaseResolver(record);
    this.logDecided(record, params.kind, identity);
    return record;
  }

  private async settleDecisionSideEffect(
    record: ApprovalDecisionRecord,
    identity: RunIdentity | null,
    operation: string,
    effect: () => Promise<void>,
  ): Promise<void> {
    try {
      await effect();
    } catch (error) {
      const logger = identity ? this.logger(identity) : createLogger();
      logger.error("approval_decision_settle_failed", {
        approvalId: record.approvalId,
        error,
        operation,
      });
    }
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

  private decisionResponseForInput(
    record: ApprovalDecisionRecord,
    submittedDecision: ApprovalDecisionRecord["decision"],
  ): ApprovalDecisionResponse {
    if (record.decision !== submittedDecision) {
      throw conflictDecisionError();
    }
    return this.decisionResponse(record);
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
 * Opens the interactive fallback pause. The caller appends the informational
 * transition only after both approval and durable model attribution succeed.
 */
export async function offerModelFallback(params: {
  broker: ApprovalBroker;
  fromModel: LogicalModelId;
  reason: ModelFallbackData["reason"];
  toModel: LogicalModelId;
}): Promise<RunDecision> {
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

/** Appends the transition only after fallback attribution is durably committed. */
export async function appendModelFallbackTransition(params: {
  append: (chunk: UIMessageChunk) => Promise<void>;
  fromModel: LogicalModelId;
  reason: ModelFallbackData["reason"];
  toModel: LogicalModelId;
}): Promise<void> {
  await params.append(modelFallbackChunk(params.fromModel, params.toModel, params.reason));
}

/** Re-arms the DO alarm to the earliest of retention vs. the approval deadline. */
export async function armAgentRunAlarm(ctx: DurableObjectState): Promise<void> {
  if (!getRunStateValue(ctx, "run_id")) {
    await ctx.storage.deleteAlarm();
    return;
  }
  const pending = readPendingApproval(ctx);
  const retentionAlarm = nextAgentRunAlarm(Date.now());
  const approvalAlarm = pending ? Math.min(pending.expiresAt, retentionAlarm) : retentionAlarm;
  const target = Math.min(
    approvalAlarm,
    pendingAssistantMessageRetryAt(ctx),
    pendingStatusRetryAt(ctx),
  );
  await ctx.storage.setAlarm(target);
}

/** Pending-approval shape for the `GET /runs/status` snapshot. */
export function pendingApprovalSnapshot(ctx: DurableObjectState): PendingApproval | undefined {
  return readPendingApproval(ctx) ?? undefined;
}

function savePendingApproval(ctx: DurableObjectState, pending: PendingApproval): void {
  setRunStateValue(ctx, PENDING_APPROVAL_KEY, JSON.stringify(pending));
}

function readPendingApproval(ctx: DurableObjectState): PendingApproval | null {
  const raw = getRunStateValue(ctx, PENDING_APPROVAL_KEY);
  if (!raw) {
    return null;
  }
  const parsed = PendingApprovalSchema.safeParse(safeJsonParse(raw));
  return parsed.success ? parsed.data : null;
}

function clearPendingApproval(ctx: DurableObjectState): void {
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
  fromModel: LogicalModelId,
  toModel: LogicalModelId,
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
