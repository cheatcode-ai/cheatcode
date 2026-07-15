import { DurableObject } from "cloudflare:workers";
import { APIError, createLogger } from "@cheatcode/observability";
import type { ArtifactRuntime, CodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import {
  AgentRunId,
  ApprovalDecisionResponseSchema,
  ProjectId,
  RunStatusSnapshotSchema,
  ThreadId,
  UserId,
} from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import { createAgentStreamResponse } from "../streaming/ui-message-stream";
import { emitRunAbandoned } from "./agent-run-abandonment";
import {
  type ApprovalDecisionInput,
  armAgentRunAlarm,
  RunApprovalController,
  type RunIdentity,
} from "./agent-run-approvals";
import { storeAgentArtifact } from "./agent-run-artifacts";
import { emitMastraChunkTelemetry } from "./agent-run-chunk-telemetry";
import type { AgentRunEnv } from "./agent-run-env";
import { handleAgentRunRequest } from "./agent-run-http";
import { executeAgentRunLifecycle } from "./agent-run-lifecycle";
import {
  pendingAssistantMessageRetryAt,
  persistOrQueueAssistantMessage,
  retryPendingAssistantMessage,
} from "./agent-run-message-persistence";
import { emitStoredAgentRunMetric } from "./agent-run-metrics";
import { persistAgentRunLogicalModel } from "./agent-run-model-persistence";
import { AgentRunOutput } from "./agent-run-output";
import { executeAgentRunPath } from "./agent-run-path";
import { resolveAgentRunRetentionAction } from "./agent-run-retention";
import type { StartRunInput } from "./agent-run-schemas";
import { agentRunStatusPayload } from "./agent-run-status-payload";
import {
  type PersistableRunStatus,
  pendingStatusRetryAt,
  persistOrQueueAgentRunStatus,
  retryPendingAgentRunStatus,
} from "./agent-run-status-persistence";
import {
  getRunStateTimestamp,
  getRunStateValue,
  initializeAgentRunStorage,
  setRunStateValue,
  updateRunRowStatus,
  upsertRunRow,
} from "./agent-run-storage";
import type { StreamDriverDeps } from "./agent-run-stream-driver";
import { mastraChunkError, normalizeMastraStreamError } from "./mastra-stream-chunks";
import { hasActiveRun } from "./run-state";
import { type AgentRunSnapshotStatus, snapshotAgentRunStatus } from "./run-summary";

type ProjectSandboxStub = CodeRuntimeContext["sandbox"];
type TerminalRunStatus = "canceled" | "completed" | "failed";
export class AgentRun extends DurableObject<AgentRunEnv> {
  private activeRunAbortController: AbortController | undefined;
  private activeRunPromise: Promise<void> | undefined;
  private cancelRequested = false;
  private deletionInProgress = false;
  private readonly approvals: RunApprovalController;
  private readonly output: AgentRunOutput;
  private requestAdmissionTail: Promise<void> = Promise.resolve();
  private statusPersistenceChain: Promise<void> = Promise.resolve();
  private terminalTransitionOpen = false;
  private terminalTransitionPromise: Promise<void> | undefined;
  private terminalTransitionStatus: TerminalRunStatus | undefined;

  public constructor(ctx: DurableObjectState, env: AgentRunEnv) {
    super(ctx, env);
    this.output = new AgentRunOutput({
      ctx: this.ctx,
      env: this.env,
      getStatus: () => this.getStatus(),
      isCanceled: () => this.isRunCanceled(),
      isTerminalizing: () => this.terminalTransitionOpen,
    });
    this.approvals = new RunApprovalController({
      append: (chunk, options) => this.append(chunk, options),
      armAlarm: () => this.armAlarm(),
      ctx: this.ctx,
      currentStatus: () => this.getStatus(),
      env: this.env,
      finalizeUnrecoverable: () => this.finalizeUnrecoverableApproval(),
      identity: () => this.runIdentity(),
      isCanceled: () => this.isRunCanceled(),
      setRunStatus: (status) => this.setRunStatus(status),
    });
    this.ctx.blockConcurrencyWhile(async () => {
      initializeAgentRunStorage(this.ctx);
    });
  }

  public override async alarm(): Promise<void> {
    if (!getRunStateValue(this.ctx, "run_id")) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.serializeStatusPersistence(() => retryPendingAgentRunStatus(this.ctx, this.env));
    await retryPendingAssistantMessage(this.ctx, this.env);
    if (await this.approvals.handleAlarmIfDue()) {
      return;
    }
    if (
      pendingAssistantMessageRetryAt(this.ctx) !== Number.POSITIVE_INFINITY ||
      pendingStatusRetryAt(this.ctx) !== Number.POSITIVE_INFINITY
    ) {
      await this.armAlarm();
      return;
    }
    const action = resolveAgentRunRetentionAction({
      completedAt: getRunStateTimestamp(this.ctx, "completed_at"),
      now: Date.now(),
    });
    if (action === "delete-all") {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (action === "clear-messages") {
      this.ctx.storage.sql.exec("DELETE FROM message_part");
    }
    await this.armAlarm();
  }

  public override fetch(request: Request): Promise<Response> {
    // Reserve FIFO admission synchronously, before request-body parsing yields.
    // A presence probe delivered after /start can therefore never observe the
    // object before that start has either parsed and claimed state or failed.
    const response = this.requestAdmissionTail.then(() =>
      handleAgentRunRequest(request, {
        approval: (userId, body) => this.approval(userId, body),
        cancel: (userId) => this.cancel(userId),
        deleteAll: (userId) => this.deleteAllState(userId),
        finalizeDetachedRun: () => this.finalizeDetachedRun(),
        resume: (userId, lastSeq) => this.resume(userId, lastSeq),
        start: (input) => this.start(input),
        status: (userId) => this.status(userId),
      }),
    );
    this.requestAdmissionTail = response.then(
      () => undefined,
      () => undefined,
    );
    return response;
  }

  private start(input: StartRunInput): Response {
    const storedRunId = getRunStateValue(this.ctx, "run_id");
    if (storedRunId === input.runId) {
      if (this.getOwnerUserId() !== input.userId) {
        return new APIError(403, "permission_denied", "Run ownership mismatch", {
          hint: "Open the thread from the account that started the active run.",
          retriable: false,
        }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
      }
      return createAgentStreamResponse({
        status: hasActiveRun(this.getStatus()) ? 202 : 200,
        stream: this.output.resume(0),
      });
    }
    if (storedRunId || hasActiveRun(this.getStatus())) {
      return new APIError(409, "conflict_run_already_active", "An agent run is already active", {
        hint: "A run-keyed Durable Object cannot be reused for a different run.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    this.resetForNewRun();
    this.cancelRequested = false;
    this.setRunIdentity(input);
    this.setOwnerUserId(input.userId);
    this.setStatus("running");
    const stream = this.output.resume(0);
    const abortController = new AbortController();
    this.activeRunAbortController = abortController;
    const runPromise = this.run(input, abortController);
    this.activeRunPromise = runPromise;
    this.ctx.waitUntil(runPromise);
    return createAgentStreamResponse({
      status: 202,
      stream,
    });
  }

  private resume(userId: string, lastSeq: number): Response {
    const ownerUserId = this.getOwnerUserId();
    if (!ownerUserId && !this.output.hasReplayRows(lastSeq) && !hasActiveRun(this.getStatus())) {
      return new Response(null, { status: 204 });
    }
    if (ownerUserId !== userId) {
      return new APIError(403, "permission_denied", "Run ownership mismatch", {
        hint: "Open the thread from the account that started the run.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    if (!this.output.hasReplayRows(lastSeq) && !hasActiveRun(this.getStatus())) {
      return new Response(null, { status: 204 });
    }
    return createAgentStreamResponse({
      stream: this.output.resume(lastSeq),
    });
  }

  private status(userId: string): Response {
    const runId = getRunStateValue(this.ctx, "run_id");
    if (!runId) {
      return new Response(null, { status: 204 });
    }
    const ownerUserId = this.getOwnerUserId();
    if (ownerUserId !== userId) {
      return new APIError(403, "permission_denied", "Run ownership mismatch", {
        hint: "Open the thread from the account that started the run.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    const status = this.snapshotStatus();
    const payload = agentRunStatusPayload({ ctx: this.ctx, status });
    if (!payload) {
      return new APIError(503, "unavailable_maintenance", "Run state is incomplete", {
        hint: "Retry the request. If it persists, start a new run.",
        retriable: true,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    return Response.json(RunStatusSnapshotSchema.parse(payload));
  }

  private async deleteAllState(userId: string): Promise<Response> {
    const ownerUserId = this.getOwnerUserId();
    if (ownerUserId && ownerUserId !== userId) {
      return new APIError(403, "permission_denied", "Run ownership mismatch", {
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    this.deletionInProgress = true;
    const activeRunPromise = this.activeRunPromise;
    const terminalTransitionPromise = this.terminalTransitionPromise;
    this.cancelRequested = true;
    this.activeRunAbortController?.abort(new Error("run state deleted"));
    await this.approvals.cancelPending();
    // Join the canceled coroutine so a late terminal-status write cannot recreate erased state.
    await activeRunPromise?.catch(() => undefined);
    await terminalTransitionPromise?.catch(() => undefined);
    this.output.closeSubscribers();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    return Response.json({ ok: true });
  }

  private async cancel(userId: string): Promise<Response> {
    const ownerUserId = this.getOwnerUserId();
    if (ownerUserId !== userId) {
      return new APIError(403, "permission_denied", "Run ownership mismatch", {
        hint: "Open the thread from the account that started the run.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    if (!hasActiveRun(this.getStatus())) {
      return Response.json({ ok: true });
    }
    await this.finalizeTerminal("canceled", () => this.commitCancellation());
    return Response.json({ ok: true });
  }

  private async commitCancellation(): Promise<void> {
    this.cancelRequested = true;
    this.activeRunAbortController?.abort(new Error("run canceled"));
    try {
      await this.approvals.cancelPending();
      await this.append(
        {
          type: "data-error",
          data: {
            v: 1,
            code: "run_canceled",
            message: "Run canceled by user.",
            retriable: false,
          },
        },
        { allowAfterCancelRequest: true },
      );
      await this.append(
        { type: "finish", finishReason: "stop" },
        { allowAfterCancelRequest: true },
      );
      const identity = this.runIdentity();
      if (identity) {
        await persistOrQueueAssistantMessage({
          ctx: this.ctx,
          env: this.env,
          logger: createLogger({ runId: identity.runId, userId: identity.userId }),
          ...identity,
        });
      }
    } finally {
      await this.persistStoredRunStatus("canceled", {
        message: "Run canceled by user.",
        type: "run_canceled",
      });
    }
  }

  private async run(input: StartRunInput, abortController: AbortController): Promise<void> {
    try {
      await executeAgentRunLifecycle(
        {
          append: (chunk) => this.append(chunk),
          ctx: this.ctx,
          env: this.env,
          executeRunPath: (runInput, sandbox, logger, signal) =>
            this.executeRunPath(runInput, sandbox, logger, signal),
          finalizeTerminal: (status, operation) => this.finalizeTerminal(status, operation),
          isCanceled: () => this.isRunCanceled(),
          output: this.output,
          persistRunStatus: (runInput, status, error) =>
            this.persistRunStatus(runInput, status, error),
          setRunStage: (stage) => this.setRunStage(stage),
        },
        input,
        abortController,
      );
    } finally {
      if (this.activeRunAbortController === abortController) {
        this.activeRunAbortController = undefined;
        this.activeRunPromise = undefined;
      }
    }
  }

  private async executeRunPath(
    input: StartRunInput,
    sandbox: ProjectSandboxStub,
    logger: ReturnType<typeof createLogger>,
    abortSignal: AbortSignal,
  ): Promise<"completed" | "continue"> {
    return executeAgentRunPath({
      abortSignal,
      append: (chunk) => this.append(chunk),
      env: this.env,
      input,
      isCanceled: () => this.isRunCanceled(),
      logger,
      sandbox,
      setRunStage: (stage) => this.setRunStage(stage),
      streamDriverDeps: this.streamDriverDeps(),
    });
  }

  private streamDriverDeps(): StreamDriverDeps {
    return {
      append: (chunk) => this.append(chunk),
      appendCheckedMastraChunk: (input, chunk) => this.appendCheckedMastraChunk(input, chunk),
      createArtifactRuntime: (input) => this.createArtifactRuntime(input),
      createBroker: () => this.approvals.createBroker(),
      env: this.env,
      hasPendingDecision: () => this.approvals.hasPendingDecision(),
      persistLogicalModel: (input, logicalModelId, logger) =>
        persistAgentRunLogicalModel({
          ctx: this.ctx,
          env: this.env,
          logger,
          logicalModelId,
          runId: input.runId,
          userId: input.userId,
        }),
      setRunStage: (stage) => this.setRunStage(stage),
    };
  }

  private async appendCheckedMastraChunk(input: StartRunInput, chunk: unknown): Promise<number> {
    const streamError = mastraChunkError(chunk);
    if (streamError) {
      throw normalizeMastraStreamError(streamError);
    }
    emitMastraChunkTelemetry(this.ctx, this.env, input, chunk);
    return this.output.appendMastraChunk(chunk);
  }

  private createArtifactRuntime(input: StartRunInput): ArtifactRuntime {
    return {
      put: async (artifact) =>
        storeAgentArtifact({
          artifact,
          env: this.env,
          input: {
            projectId: ProjectId(input.projectId),
            runId: AgentRunId(input.runId),
            threadId: ThreadId(input.threadId),
            userId: UserId(input.userId),
          },
        }),
    };
  }

  private async append(
    chunk: UIMessageChunk,
    options?: { allowAfterCancelRequest?: boolean },
  ): Promise<void> {
    await this.output.append(chunk, options);
  }

  private getStatus(): string | undefined {
    return getRunStateValue(this.ctx, "status");
  }

  private snapshotStatus(): AgentRunSnapshotStatus {
    return snapshotAgentRunStatus(this.getStatus());
  }

  private setStatus(status: "running" | "paused" | "completed" | "failed" | "canceled"): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO run_state (key, value) VALUES ('status', ?)",
      status,
    );
    updateRunRowStatus(this.ctx, status);
    if (status === "completed" || status === "failed" || status === "canceled") {
      setRunStateValue(this.ctx, "completed_at", String(Date.now()));
    }
  }

  /** Flips both the DO run state and the Postgres row. */
  private async setRunStatus(status: "paused" | "running"): Promise<void> {
    this.setStatus(status);
    await this.persistStoredRunStatus(status);
  }

  private armAlarm(): Promise<void> {
    return armAgentRunAlarm(this.ctx);
  }

  private runIdentity(): RunIdentity | null {
    const runId = getRunStateValue(this.ctx, "run_id");
    const threadId = getRunStateValue(this.ctx, "thread_id");
    const userId = this.getOwnerUserId();
    if (!runId || !threadId || !userId) {
      return null;
    }
    return { runId, threadId, userId };
  }

  private async approval(userId: string, body: ApprovalDecisionInput): Promise<Response> {
    if (this.getOwnerUserId() !== userId) {
      return new APIError(403, "permission_denied", "Run ownership mismatch", {
        hint: "Open the thread from the account that started the run.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    try {
      const result = await this.approvals.applyDecision({
        approvalId: body.approvalId,
        decision: body.decision,
        ...(body.reason ? { reason: body.reason } : {}),
      });
      return Response.json(ApprovalDecisionResponseSchema.parse(result));
    } catch (error) {
      if (error instanceof APIError) {
        return error.toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
      }
      throw error;
    }
  }

  /** DO eviction mid-approval: fail the run deterministically. */
  private async finalizeUnrecoverableApproval(): Promise<void> {
    await this.finalizeTerminal("failed", () => this.commitUnrecoverableApproval());
  }

  private async commitUnrecoverableApproval(): Promise<void> {
    await this.append({
      type: "data-error",
      data: {
        v: 1,
        code: "approval_unrecoverable",
        message: "Run could not recover the pending approval after a restart. Start a new run.",
        retriable: false,
      },
    });
    await this.append({ type: "finish", finishReason: "error" });
    const identity = this.runIdentity();
    if (identity) {
      await persistOrQueueAssistantMessage({
        ctx: this.ctx,
        env: this.env,
        logger: createLogger({ runId: identity.runId, userId: identity.userId }),
        ...identity,
      });
      await this.persistRunStatusById({
        error: { message: "Pending approval was unrecoverable.", type: "approval_unrecoverable" },
        runId: identity.runId,
        status: "failed",
        userId: identity.userId,
      });
    }
  }

  /** A persisted running state without its execution controller can never make progress. */
  private async finalizeDetachedRun(): Promise<void> {
    if (this.getStatus() !== "running" || this.activeRunAbortController) {
      return;
    }
    const identity = this.runIdentity();
    if (!identity) {
      return;
    }
    await this.finalizeTerminal("failed", () => this.commitDetachedRun(identity));
  }

  private async commitDetachedRun(identity: RunIdentity): Promise<void> {
    emitRunAbandoned(this.ctx, this.env);
    const message = "This run was interrupted before it finished. Send the prompt again to retry.";
    await this.append({
      type: "data-error",
      data: { v: 1, code: "run_interrupted", message, retriable: true },
    });
    await this.append({ type: "finish", finishReason: "error" });
    await persistOrQueueAssistantMessage({
      ctx: this.ctx,
      env: this.env,
      logger: createLogger({ runId: identity.runId, userId: identity.userId }),
      ...identity,
    });
    await this.persistRunStatusById({
      error: { message, type: "run_interrupted" },
      runId: identity.runId,
      status: "failed",
      userId: identity.userId,
    });
  }

  private setRunIdentity(input: StartRunInput): void {
    setRunStateValue(this.ctx, "run_id", input.runId);
    setRunStateValue(this.ctx, "thread_id", input.threadId);
    setRunStateValue(this.ctx, "project_id", input.projectId);
    if (input.isFirstRun) setRunStateValue(this.ctx, "is_first_run", "true");
    upsertRunRow(this.ctx, {
      plannedLogicalModelId: input.model,
      projectId: input.projectId,
      runId: input.runId,
      threadId: input.threadId,
      userId: input.userId,
    });
  }

  private getOwnerUserId(): string | undefined {
    return getRunStateValue(this.ctx, "owner_user_id");
  }

  private setOwnerUserId(userId: string): void {
    setRunStateValue(this.ctx, "owner_user_id", userId);
  }

  private setRunStage(stage: string): void {
    setRunStateValue(this.ctx, "run_stage", stage);
  }

  private isRunCanceled(): boolean {
    return this.cancelRequested || this.getStatus() === "canceled";
  }

  private resetForNewRun(): void {
    this.deletionInProgress = false;
    this.terminalTransitionOpen = false;
    this.terminalTransitionPromise = undefined;
    this.terminalTransitionStatus = undefined;
    this.ctx.storage.sql.exec("DELETE FROM message_part");
    this.ctx.storage.sql.exec("DELETE FROM run");
    this.ctx.storage.sql.exec("DELETE FROM run_state");
  }

  private async persistRunStatus(
    input: StartRunInput,
    status: PersistableRunStatus,
    error?: { message: string; type: string },
  ): Promise<void> {
    await this.persistRunStatusById({
      ...(error ? { error } : {}),
      runId: input.runId,
      status,
      userId: input.userId,
    });
  }

  private async persistStoredRunStatus(
    status: PersistableRunStatus,
    error?: { message: string; type: string },
  ): Promise<void> {
    const runId = getRunStateValue(this.ctx, "run_id");
    const userId = this.getOwnerUserId();
    if (!runId || !userId) {
      return;
    }
    await this.persistRunStatusById({ ...(error ? { error } : {}), runId, status, userId });
  }

  private async persistRunStatusById(input: {
    error?: { message: string; type: string };
    runId: string;
    status: PersistableRunStatus;
    userId: string;
  }): Promise<void> {
    await this.serializeStatusPersistence(async () => {
      emitStoredAgentRunMetric(this.ctx, this.env, input);
      await persistOrQueueAgentRunStatus(this.ctx, this.env, input);
    });
    await this.armAlarm();
  }

  private async finalizeTerminal(
    status: TerminalRunStatus,
    operation: () => Promise<void>,
  ): Promise<boolean> {
    if (!this.tryCommitTerminal(status)) {
      return false;
    }
    const transition = this.performTerminalTransition(status, operation);
    this.terminalTransitionPromise = transition;
    try {
      await transition;
      return true;
    } finally {
      if (this.terminalTransitionPromise === transition) {
        this.terminalTransitionPromise = undefined;
      }
    }
  }

  private async performTerminalTransition(
    status: TerminalRunStatus,
    operation: () => Promise<void>,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      await this.persistTerminalFallback(status, error);
      throw error;
    } finally {
      this.terminalTransitionOpen = false;
      this.output.closeSubscribers();
    }
  }

  private tryCommitTerminal(status: TerminalRunStatus): boolean {
    if (
      this.deletionInProgress ||
      this.terminalTransitionStatus ||
      !hasActiveRun(this.getStatus())
    ) {
      return false;
    }
    this.terminalTransitionStatus = status;
    this.terminalTransitionOpen = true;
    this.setStatus(status);
    return true;
  }

  private async persistTerminalFallback(status: TerminalRunStatus, error: unknown): Promise<void> {
    const runId = getRunStateValue(this.ctx, "run_id");
    const logger = createLogger(runId ? { runId } : {});
    logger.error("agent_terminal_finalize_failed", { error, terminalStatus: status });
    await this.persistStoredRunStatus(status).catch((persistError: unknown) => {
      logger.error("agent_terminal_fallback_persist_failed", {
        error: persistError,
        terminalStatus: status,
      });
    });
  }

  private async serializeStatusPersistence(operation: () => Promise<void>): Promise<void> {
    const current = this.statusPersistenceChain.then(operation);
    this.statusPersistenceChain = current.catch(() => undefined);
    await current;
  }
}
