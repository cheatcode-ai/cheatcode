import { DurableObject } from "cloudflare:workers";
import { APIError, createLogger } from "@cheatcode/observability";
import { RunStatusSnapshotSchema } from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import { createAgentStreamResponse } from "../streaming/ui-message-stream";
import { armAgentRunAlarm } from "./agent-run-alarm";
import { AgentRunBrowserTakeover } from "./agent-run-browser-takeover";
import type { AgentRunEnv } from "./agent-run-env";
import {
  pendingAssistantMessageRetryAt,
  persistOrQueueAssistantMessage,
  retryPendingAssistantMessage,
} from "./agent-run-message-persistence";
import { persistAgentRunLogicalModel } from "./agent-run-model-persistence";
import { AgentRunOutput } from "./agent-run-output";
import {
  absentAgentRunOkResponse,
  absentAgentRunWorkflowResponse,
  agentRunStreamCapacityResponse,
  agentRunWorkflowResponse,
  deletedAgentRunResponse,
} from "./agent-run-responses";
import { resolveAgentRunRetentionAction } from "./agent-run-retention";
import type { StartRunInput } from "./agent-run-schemas";
import { agentRunStatusPayload } from "./agent-run-status-payload";
import {
  type PersistableRunStatus,
  pendingStatusRetryAt,
  persistSerializedAgentRunStatus,
  retryPendingAgentRunStatus,
} from "./agent-run-status-persistence";
import {
  assertAgentRunStorage,
  claimAgentRunDeletion,
  getRunStateTimestamp,
  getRunStateValue,
  hasAgentRunStorage,
  initializeAgentRunStorage,
  isAgentRunDeleted,
  setAgentRunStage,
  setRunStateValue,
  updateRunRowStatus,
  upsertRunRow,
} from "./agent-run-storage";
import {
  invalidResumeCursorResponse,
  missingInternalUserResponse,
  type RunIdentity,
  type TerminalRunStatus,
} from "./agent-run-support";
import { AgentRunWorkflowController } from "./agent-run-workflow-controller";
import type {
  AgentRunWorkflowCallbackInput,
  AgentRunWorkflowEventInput,
  AgentRunWorkflowFailureInput,
  AgentRunWorkflowModelInput,
  AgentRunWorkflowStageInput,
} from "./agent-run-workflow-protocol";
import { hasActiveRun, parseLastSeqParam } from "./run-state";
import { type AgentRunSnapshotStatus, snapshotAgentRunStatus } from "./run-summary";

export class AgentRun extends DurableObject<AgentRunEnv> {
  private alarmExecutionPromise: Promise<void> | undefined;
  private cancelRequested = false;
  private deletionInProgress = false;
  private readonly output: AgentRunOutput;
  private readonly browserTakeover: AgentRunBrowserTakeover;
  private requestAdmissionTail: Promise<void> = Promise.resolve();
  private statusPersistenceChain: Promise<void> = Promise.resolve();
  private terminalTransitionOpen = false;
  private terminalTransitionPromise: Promise<void> | undefined;
  private terminalTransitionStatus: TerminalRunStatus | undefined;
  private readonly workflow: AgentRunWorkflowController;
  public constructor(ctx: DurableObjectState, env: AgentRunEnv) {
    super(ctx, env);
    this.output = new AgentRunOutput({
      ctx: this.ctx,
      env: this.env,
      getStatus: () => this.getStatus(),
      isCanceled: () => this.isRunCanceled(),
      isTerminalizing: () => this.terminalTransitionOpen,
    });
    this.browserTakeover = new AgentRunBrowserTakeover({
      ctx: this.ctx,
      env: this.env,
      getOwnerUserId: () => this.getOwnerUserId(),
      getStatus: () => this.getStatus(),
    });
    this.workflow = new AgentRunWorkflowController({
      armAlarm: () => this.armAlarm(),
      ctx: this.ctx,
      env: this.env,
      finalizeWorkflowFailure: (failure) => this.finalizeWorkflowFailure(failure),
      getStatus: () => this.getStatus(),
    });
  }

  public override async alarm(): Promise<void> {
    if (!hasAgentRunStorage(this.ctx)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    assertAgentRunStorage(this.ctx);
    const execution = this.handleAlarm();
    this.alarmExecutionPromise = execution;
    try {
      await execution;
    } finally {
      if (this.alarmExecutionPromise === execution) {
        this.alarmExecutionPromise = undefined;
      }
    }
  }

  private async handleAlarm(): Promise<void> {
    if (isAgentRunDeleted(this.ctx)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (!getRunStateValue(this.ctx, "run_id")) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (await this.workflow.recoverPendingAdmission()) {
      return;
    }
    await this.workflow.reconcileAdmission();
    await retryPendingAssistantMessage(this.ctx, this.env);
    if (pendingAssistantMessageRetryAt(this.ctx) === Number.POSITIVE_INFINITY) {
      await this.serializeStatusPersistence(() => retryPendingAgentRunStatus(this.ctx, this.env));
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
      this.deletionInProgress = true;
      await this.ctx.storage.deleteAll();
      return;
    }
    if (action === "clear-messages") {
      this.ctx.storage.sql.exec("DELETE FROM message_part");
    }
    await this.armAlarm();
  }

  public override fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/stream") {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
    const lastSeq = parseLastSeqParam(url.searchParams.get("lastSeq"));
    if (lastSeq === null) {
      return Promise.resolve(invalidResumeCursorResponse());
    }
    const userId = request.headers.get("X-Cheatcode-User-Id");
    if (!userId) {
      return Promise.resolve(missingInternalUserResponse("streams"));
    }
    return this.enqueueRequest(() =>
      this.withStorage(
        () => this.resume(userId, lastSeq),
        () => new Response(null, { status: 204 }),
      ),
    );
  }

  public start(input: StartRunInput): Promise<Response> {
    return this.enqueueRequest(() => {
      if (!hasAgentRunStorage(this.ctx)) {
        initializeAgentRunStorage(this.ctx);
      } else {
        assertAgentRunStorage(this.ctx);
      }
      return this.startInternal(input);
    });
  }

  public status(userId: string): Promise<Response> {
    return this.enqueueRequest(() =>
      this.withStorage(
        () => this.statusInternal(userId),
        () => new Response(null, { status: 204 }),
      ),
    );
  }

  public cancel(userId: string): Promise<Response> {
    return this.enqueueRequest(() =>
      this.withStorage(() => this.cancelInternal(userId), absentAgentRunOkResponse),
    );
  }

  public deleteAll(userId: string): Promise<Response> {
    return this.enqueueRequest(() =>
      this.withStorage(() => this.deleteAllState(userId), absentAgentRunOkResponse),
    );
  }

  public browserTakeoverStatus(userId: string): Promise<Response> {
    return this.enqueueRequest(() =>
      this.withStorage(() => this.browserTakeover.status(userId), absentAgentRunOkResponse),
    );
  }

  public browserTakeoverStart(userId: string): Promise<Response> {
    return this.enqueueRequest(() =>
      this.withStorage(() => this.browserTakeover.start(userId), absentAgentRunOkResponse),
    );
  }

  public browserTakeoverResume(userId: string, takeoverId: string): Promise<Response> {
    return this.enqueueRequest(() =>
      this.withStorage(
        () => this.browserTakeover.resume(userId, takeoverId),
        absentAgentRunOkResponse,
      ),
    );
  }

  public beginWorkflow(input: AgentRunWorkflowCallbackInput): Promise<Response> {
    return this.enqueueRequest(() =>
      this.withStorage(
        () => agentRunWorkflowResponse(() => this.beginWorkflowInternal(input)),
        absentAgentRunWorkflowResponse,
      ),
    );
  }

  public appendWorkflowEvent(input: AgentRunWorkflowEventInput): Promise<Response> {
    return this.enqueueRequest(() =>
      this.withStorage(
        () => agentRunWorkflowResponse(() => this.appendWorkflowEventInternal(input)),
        absentAgentRunWorkflowResponse,
      ),
    );
  }

  public setWorkflowStage(input: AgentRunWorkflowStageInput): Promise<Response> {
    return this.enqueueRequest(() =>
      this.withStorage(
        () => agentRunWorkflowResponse(() => this.setWorkflowStageInternal(input)),
        absentAgentRunWorkflowResponse,
      ),
    );
  }

  public persistWorkflowModel(input: AgentRunWorkflowModelInput): Promise<Response> {
    return this.enqueueRequest(() =>
      this.withStorage(
        () => agentRunWorkflowResponse(() => this.persistWorkflowModelInternal(input)),
        absentAgentRunWorkflowResponse,
      ),
    );
  }

  public completeWorkflow(input: AgentRunWorkflowCallbackInput): Promise<Response> {
    return this.enqueueRequest(() =>
      this.withStorage(
        () => agentRunWorkflowResponse(() => this.completeWorkflowInternal(input)),
        absentAgentRunWorkflowResponse,
      ),
    );
  }

  public cleanupWorkflow(input: AgentRunWorkflowCallbackInput): Promise<Response> {
    return this.enqueueRequest(() =>
      this.withStorage(
        () => agentRunWorkflowResponse(() => this.cleanupWorkflowInternal(input)),
        absentAgentRunWorkflowResponse,
      ),
    );
  }

  public waitForBrowserTakeover(input: AgentRunWorkflowCallbackInput): Promise<number> {
    return this.enqueueRequest(async () => {
      if (!hasAgentRunStorage(this.ctx)) return 0;
      assertAgentRunStorage(this.ctx);
      return (await this.workflow.authorizeCallback(input)) === "current"
        ? this.browserTakeover.wait(AbortSignal.timeout(10 * 60_000))
        : 0;
    });
  }

  public failWorkflow(input: AgentRunWorkflowFailureInput): Promise<Response> {
    return this.enqueueRequest(() =>
      this.withStorage(
        () => agentRunWorkflowResponse(() => this.workflow.failWorkflow(input)),
        absentAgentRunOkResponse,
      ),
    );
  }

  private enqueueRequest<T>(operation: () => Promise<T> | T): Promise<T> {
    // FIFO admission makes start settle before a later presence probe observes the object.
    const response = this.requestAdmissionTail.then(operation);
    this.requestAdmissionTail = response.then(
      () => undefined,
      () => undefined,
    );
    return response;
  }

  private withStorage(
    operation: () => Promise<Response> | Response,
    absent: () => Response,
  ): Promise<Response> | Response {
    if (!hasAgentRunStorage(this.ctx)) {
      return absent();
    }
    assertAgentRunStorage(this.ctx);
    return operation();
  }

  private async startInternal(input: StartRunInput): Promise<Response> {
    if (this.deletionInProgress || isAgentRunDeleted(this.ctx)) {
      return deletedAgentRunResponse();
    }
    const storedRunId = getRunStateValue(this.ctx, "run_id");
    if (storedRunId === input.runId) {
      return this.resumeExistingStart(input);
    }
    if (storedRunId || hasActiveRun(this.getStatus())) {
      return new APIError(409, "conflict_run_already_active", "An agent run is already active", {
        hint: "A run-keyed Durable Object cannot be reused for a different run.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    if (!this.output.hasStreamCapacity()) {
      return agentRunStreamCapacityResponse();
    }
    const admission = await this.workflow.createAdmission(input);
    await this.workflow.armAdmissionRecovery();
    this.cancelRequested = false;
    this.workflow.claimAdmission(admission, () => {
      this.setRunIdentity(input);
      this.setOwnerUserId(input.userId);
      this.setStatus("running");
    });
    await this.workflow.admit(admission);
    const stream = this.output.resume(0);
    if (!stream) {
      return agentRunStreamCapacityResponse();
    }
    return createAgentStreamResponse({
      status: 202,
      stream,
    });
  }

  private async resumeExistingStart(input: StartRunInput): Promise<Response> {
    if (this.getOwnerUserId() !== input.userId) {
      return new APIError(403, "permission_access_denied", "Run ownership mismatch", {
        hint: "Open the thread from the account that started the active run.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    if (!this.output.hasStreamCapacity()) {
      return agentRunStreamCapacityResponse();
    }
    if (hasActiveRun(this.getStatus())) {
      await this.workflow.admit(await this.workflow.createAdmission(input));
    }
    const stream = this.output.resume(0);
    if (!stream) {
      return agentRunStreamCapacityResponse();
    }
    return createAgentStreamResponse({
      status: hasActiveRun(this.getStatus()) ? 202 : 200,
      stream,
    });
  }

  private resume(userId: string, lastSeq: number): Response {
    const ownerUserId = this.getOwnerUserId();
    if (!ownerUserId && !this.output.hasReplayRows(lastSeq) && !hasActiveRun(this.getStatus())) {
      return new Response(null, { status: 204 });
    }
    if (ownerUserId !== userId) {
      return new APIError(403, "permission_access_denied", "Run ownership mismatch", {
        hint: "Open the thread from the account that started the run.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    if (!this.output.hasReplayRows(lastSeq) && !hasActiveRun(this.getStatus())) {
      return new Response(null, { status: 204 });
    }
    const stream = this.output.resume(lastSeq);
    return stream ? createAgentStreamResponse({ stream }) : agentRunStreamCapacityResponse();
  }

  private async statusInternal(userId: string): Promise<Response> {
    const runId = getRunStateValue(this.ctx, "run_id");
    if (!runId) {
      return new Response(null, { status: 204 });
    }
    const ownerUserId = this.getOwnerUserId();
    if (ownerUserId !== userId) {
      return new APIError(403, "permission_access_denied", "Run ownership mismatch", {
        hint: "Open the thread from the account that started the run.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    if (hasActiveRun(this.getStatus())) {
      await this.workflow.reconcileAdmission();
    }
    const status = this.snapshotStatus();
    const payload = agentRunStatusPayload({ ctx: this.ctx, status });
    if (!payload) {
      return new APIError(503, "service_maintenance_unavailable", "Run state is incomplete", {
        hint: "Retry the request. If it persists, start a new run.",
        retriable: true,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    return Response.json(RunStatusSnapshotSchema.parse(payload));
  }

  private async deleteAllState(userId: string): Promise<Response> {
    if (!claimAgentRunDeletion(this.ctx, userId)) {
      return new APIError(403, "permission_access_denied", "Run ownership mismatch", {
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    this.deletionInProgress = true;
    const alarmExecutionPromise = this.alarmExecutionPromise;
    const terminalTransitionPromise = this.terminalTransitionPromise;
    this.cancelRequested = true;
    await this.workflow.terminate().catch(() => undefined);
    await Promise.all([
      alarmExecutionPromise?.catch(() => undefined),
      terminalTransitionPromise?.catch(() => undefined),
    ]);
    await this.statusPersistenceChain;
    this.output.closeSubscribers();
    await this.ctx.storage.deleteAll();
    return Response.json({ ok: true });
  }

  private async cancelInternal(userId: string): Promise<Response> {
    const ownerUserId = this.getOwnerUserId();
    if (ownerUserId !== userId) {
      return new APIError(403, "permission_access_denied", "Run ownership mismatch", {
        hint: "Open the thread from the account that started the run.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    if (!hasActiveRun(this.getStatus())) {
      return Response.json({ ok: true });
    }
    await this.finalizeTerminal("canceled", () => this.commitCancellation(), true);
    return Response.json({ ok: true });
  }

  private async commitCancellation(): Promise<void> {
    this.cancelRequested = true;
    await this.workflow.terminate().catch((error: unknown) => {
      createLogger().warn("agent_run_workflow_termination_failed", { error });
    });
    try {
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
      await this.persistStoredRunStatus(
        "canceled",
        {
          message: "Run canceled by user.",
          type: "run_canceled",
        },
        true,
      );
    }
  }

  private async beginWorkflowInternal(input: AgentRunWorkflowCallbackInput): Promise<Response> {
    const outcome = await this.workflow.authorizeCallback(input);
    if (outcome !== "current") return Response.json({ outcome });
    setAgentRunStage(this.ctx, "Preparing project sandbox.");
    this.output.appendWorkflowEvent("run:start", [
      { messageId: input.input.runId, type: "start" },
      { data: { status: "starting", v: 1 }, type: "data-sandbox-status" },
    ]);
    await this.persistRunStatusById({
      isArtifactsQuiesced: false,
      runId: input.input.runId,
      status: "running",
      userId: input.input.userId,
    });
    return Response.json({ outcome: "current" });
  }

  private async appendWorkflowEventInternal(input: AgentRunWorkflowEventInput): Promise<Response> {
    const outcome = await this.workflow.authorizeCallback(input);
    if (outcome !== "current") return Response.json({ appendedCount: 0, outcome });
    const appendedCount = this.output.appendWorkflowEvent(input.eventKey, input.chunks);
    return Response.json({ appendedCount, outcome });
  }

  private async setWorkflowStageInternal(input: AgentRunWorkflowStageInput): Promise<Response> {
    const outcome = await this.workflow.authorizeCallback(input);
    if (outcome === "current") setAgentRunStage(this.ctx, input.stage);
    return Response.json({ outcome });
  }

  private async persistWorkflowModelInternal(input: AgentRunWorkflowModelInput): Promise<Response> {
    const outcome = await this.workflow.authorizeCallback(input);
    if (outcome !== "current") return Response.json({ outcome });
    await persistAgentRunLogicalModel({
      ctx: this.ctx,
      env: this.env,
      logger: createLogger({ runId: input.input.runId, userId: input.input.userId }),
      logicalModelId: input.logicalModelId,
      runId: input.input.runId,
      userId: input.input.userId,
    });
    return Response.json({ outcome });
  }

  private async completeWorkflowInternal(input: AgentRunWorkflowCallbackInput): Promise<Response> {
    const outcome = await this.workflow.authorizeCallback(input);
    if (outcome !== "current") return Response.json({ outcome });
    await this.finalizeTerminal(
      "completed",
      async () => {
        this.output.appendWorkflowEvent("run:complete", [
          { data: { status: "ready", v: 1 }, type: "data-sandbox-status" },
          { finishReason: "stop", type: "finish" },
        ]);
        const identity = this.runIdentity();
        if (identity) {
          await persistOrQueueAssistantMessage({
            ctx: this.ctx,
            env: this.env,
            logger: createLogger({ runId: identity.runId, userId: identity.userId }),
            ...identity,
          });
        }
        await this.persistStoredRunStatus("completed", undefined, true);
      },
      true,
    );
    return Response.json({ outcome: "terminal" });
  }

  private async cleanupWorkflowInternal(input: AgentRunWorkflowCallbackInput): Promise<Response> {
    await this.workflow.authorizeCallback(input);
    await this.browserTakeover.cleanup();
    return Response.json({ ok: true });
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

  private setStatus(status: "running" | "completed" | "failed" | "canceled"): void {
    if (isAgentRunDeleted(this.ctx)) {
      return;
    }
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO run_state (key, value) VALUES ('status', ?)",
      status,
    );
    updateRunRowStatus(this.ctx, status);
    if (status === "completed" || status === "failed" || status === "canceled") {
      setRunStateValue(this.ctx, "completed_at", String(Date.now()));
    }
  }

  private armAlarm(): Promise<void> {
    if (isAgentRunDeleted(this.ctx)) {
      return this.ctx.storage.deleteAlarm();
    }
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

  private async finalizeWorkflowFailure(input: {
    code: string;
    message: string;
    retriable: boolean;
  }): Promise<void> {
    if (isAgentRunDeleted(this.ctx)) {
      return;
    }
    await this.finalizeTerminal("failed", () => this.commitWorkflowFailure(input), true);
  }

  private async commitWorkflowFailure(input: {
    code: string;
    message: string;
    retriable: boolean;
  }): Promise<void> {
    await this.append(
      {
        type: "data-error",
        data: { v: 1, code: input.code, message: input.message, retriable: input.retriable },
      },
      { allowAfterCancelRequest: true },
    );
    await this.append({ type: "finish", finishReason: "error" }, { allowAfterCancelRequest: true });
    const identity = this.runIdentity();
    if (identity) {
      await persistOrQueueAssistantMessage({
        ctx: this.ctx,
        env: this.env,
        logger: createLogger({ runId: identity.runId, userId: identity.userId }),
        ...identity,
      });
    }
    await this.persistStoredRunStatus("failed", { message: input.message, type: input.code }, true);
  }

  private setRunIdentity(input: StartRunInput): void {
    setRunStateValue(this.ctx, "run_id", input.runId);
    setRunStateValue(this.ctx, "thread_id", input.threadId);
    setRunStateValue(this.ctx, "sandbox_name", input.sandboxName);
    if (input.projectId) {
      setRunStateValue(this.ctx, "project_id", input.projectId);
    }
    if (input.isFirstRun) setRunStateValue(this.ctx, "is_first_run", "true");
    upsertRunRow(this.ctx, {
      plannedLogicalModelId: input.model,
      runId: input.runId,
    });
  }

  private getOwnerUserId(): string | undefined {
    return getRunStateValue(this.ctx, "owner_user_id");
  }

  private setOwnerUserId(userId: string): void {
    setRunStateValue(this.ctx, "owner_user_id", userId);
  }

  private isRunCanceled(): boolean {
    return isAgentRunDeleted(this.ctx) || this.cancelRequested || this.getStatus() === "canceled";
  }

  private async persistStoredRunStatus(
    status: PersistableRunStatus,
    error?: { message: string; type: string },
    isArtifactsQuiesced = false,
  ): Promise<void> {
    const runId = getRunStateValue(this.ctx, "run_id");
    const userId = this.getOwnerUserId();
    if (!runId || !userId) {
      return;
    }
    await this.persistRunStatusById({
      isArtifactsQuiesced,
      ...(error ? { error } : {}),
      runId,
      status,
      userId,
    });
  }

  private async persistRunStatusById(input: {
    isArtifactsQuiesced: boolean;
    error?: { message: string; type: string };
    runId: string;
    status: PersistableRunStatus;
    userId: string;
  }): Promise<void> {
    await persistSerializedAgentRunStatus(
      this.ctx,
      this.env,
      input,
      (operation) => this.serializeStatusPersistence(operation),
      () => this.armAlarm(),
    );
  }

  private async finalizeTerminal(
    status: TerminalRunStatus,
    operation: () => Promise<void>,
    isArtifactsQuiesced: boolean,
  ): Promise<boolean> {
    if (!this.tryCommitTerminal(status)) {
      return false;
    }
    const transition = this.performTerminalTransition(status, operation, isArtifactsQuiesced);
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
    isArtifactsQuiesced: boolean,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      await this.persistTerminalFallback(status, error, isArtifactsQuiesced);
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

  private async persistTerminalFallback(
    status: TerminalRunStatus,
    error: unknown,
    isArtifactsQuiesced: boolean,
  ): Promise<void> {
    const runId = getRunStateValue(this.ctx, "run_id");
    const logger = createLogger(runId ? { runId } : {});
    logger.error("agent_terminal_finalize_failed", { error, terminalStatus: status });
    await this.persistStoredRunStatus(status, undefined, isArtifactsQuiesced).catch(
      (persistError: unknown) => {
        logger.error("agent_terminal_fallback_persist_failed", {
          error: persistError,
          terminalStatus: status,
        });
      },
    );
  }

  private async serializeStatusPersistence(operation: () => Promise<void>): Promise<void> {
    const current = this.statusPersistenceChain.then(operation);
    this.statusPersistenceChain = current.catch(() => undefined);
    await current;
  }
}
