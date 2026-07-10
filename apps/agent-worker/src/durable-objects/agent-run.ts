import { DurableObject } from "cloudflare:workers";
import { mastra } from "@cheatcode/agent-core";
import { APIError, createLogger } from "@cheatcode/observability";
import type { ArtifactRuntime, CodeRuntimeContext } from "@cheatcode/tools-code";
import { ApprovalDecisionResponseSchema } from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import {
  createAgentStreamResponse,
  createSeqChunk,
  isMessagePartRow,
  parseSequencedChunk,
} from "../streaming/ui-message-stream";
import { emitRunAbandoned } from "./agent-run-abandonment";
import {
  restartMobilePreview,
  restoreBestEffortSnapshot,
  runAppBuilder,
  snapshotAppBuilderWorkspace,
  warmSandbox,
} from "./agent-run-app-builder";
import {
  type ApprovalDecisionInput,
  ApprovalDecisionInputSchema,
  armAgentRunAlarm,
  RunApprovalController,
  type RunIdentity,
} from "./agent-run-approvals";
import { storeAgentArtifact } from "./agent-run-artifacts";
import { ZERO_BUDGET_SNAPSHOT } from "./agent-run-budget-persistence";
import { emitMastraChunkTelemetry } from "./agent-run-chunk-telemetry";
import {
  appendBudgetStatus,
  appendCostCapExhausted,
  type BudgetAccountingDeps,
  costCapExhaustion,
  enforceCostCaps,
  enforceFreeDeepseekCap,
  isCostCapAPIError,
  recordBudgetDelta,
} from "./agent-run-cost-caps";
import { directRunCodeInputFromPrompt, runDirectRunCode } from "./agent-run-direct-code";
import type { AgentRunEnv } from "./agent-run-env";
import { toAgentRunStreamError } from "./agent-run-errors";
import {
  persistAssistantMessage,
  persistAssistantMessageForIdentity,
} from "./agent-run-message-persistence";
import { emitStoredAgentRunMetric } from "./agent-run-metrics";
import { emitFirstVisibleChunkMetric } from "./agent-run-performance";
import { runPlanChunk, runTaskStatusChunk } from "./agent-run-progress";
import { resolveAgentRunRetentionAction } from "./agent-run-retention";
import {
  ResumeTakeoverInputSchema,
  RunStatusSnapshotSchema,
  type StartRunInput,
  StartRunInputSchema,
  TakeoverStateInputSchema,
} from "./agent-run-schemas";
import { agentRunStatusPayload } from "./agent-run-status-payload";
import { type PersistableRunStatus, persistAgentRunStatus } from "./agent-run-status-persistence";
import {
  appendAgentRunMessagePart,
  applyAgentRunStorageMigrations,
  ensureAgentRunRetentionAlarm,
  getRunStateTimestamp,
  getRunStateValue,
  setRunStateValue,
  updateRunRowStatus,
  upsertRunRow,
} from "./agent-run-storage";
import { type StreamDriverDeps, streamMastraRunWithFallback } from "./agent-run-stream-driver";
import {
  consumeTakeoverStateInStorage,
  saveTakeoverStateInStorage,
} from "./agent-run-takeover-state";
import { isAppBuilderRequest, missingInternalUserResponse } from "./agent-run-utils";
import type { LlmCredential } from "./llm-provider";
import {
  mastraChunkError,
  mastraChunkToUiChunks,
  normalizeMastraStreamError,
  usageFromMastraChunk,
} from "./mastra-stream-chunks";
import { hasActiveRun, parseLastSeqParam } from "./run-state";
import { type AgentRunSnapshotStatus, snapshotAgentRunStatus } from "./run-summary";

const INTERNAL_USER_HEADER = "X-Cheatcode-User-Id";
const MINIMUM_RUN_BUDGET_USD = 0.01;
// Visible activity rows that end the current answer text segment (a new narration run
// after one of these becomes its own text part). Hidden chrome (sandbox-status, budget,
// plan) and collected deliverables (data-artifact) do NOT break a segment.
const ANSWER_SEGMENT_BREAK_TYPES = new Set<string>(["data-tool", "data-thinking"]);
type Subscriber = { controller: ReadableStreamDefaultController<UIMessageChunk> };
type ProjectSandboxStub = CodeRuntimeContext["sandbox"];
export class AgentRun extends DurableObject<AgentRunEnv> {
  private activeRunAbortController: AbortController | undefined;
  private cancelRequested = false;
  private readonly subscribers = new Set<Subscriber>();
  private readonly approvals: RunApprovalController;
  // Answer-text segmentation state (see appendAnswerSegmented): the id of the open
  // text part, and a monotonic counter for unique per-segment ids within a run.
  private openAnswerSegmentId: string | null = null;
  private answerSegmentCount = 0;
  // Backstop state: whether the model's last visible action was answer text (it
  // delivered a closing), and whether a preview / downloadable deliverable appeared —
  // so a run that ends on a bare tool call still closes with a useful message.
  private lastVisibleWasAnswerText = false;
  private sawPreviewUrl = false;
  private sawArtifact = false;

  public constructor(ctx: DurableObjectState, env: AgentRunEnv) {
    super(ctx, env);
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
      applyAgentRunStorageMigrations(this.ctx);
      await ensureAgentRunRetentionAlarm(this.ctx);
    });
  }

  public override async alarm(): Promise<void> {
    if (await this.approvals.handleAlarmIfDue()) {
      return;
    }
    const action = resolveAgentRunRetentionAction({
      completedAt: getRunStateTimestamp(this.ctx, "completed_at"),
      now: Date.now(),
    });
    if (action === "delete-all") {
      await this.ctx.storage.deleteAll();
      return;
    }
    if (action === "clear-messages") {
      this.ctx.storage.sql.exec("DELETE FROM message_part");
    }
    await this.armAlarm();
  }

  public override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST") {
      return this.handlePost(request, url.pathname);
    }
    if (request.method === "GET" && url.pathname === "/status") {
      const userId = this.readInternalUser(request);
      return userId ? this.status(userId) : missingInternalUserResponse("status");
    }
    if (request.method === "GET" && url.pathname === "/stream") {
      return this.stream(request, url);
    }
    return new Response("Not found", { status: 404 });
  }

  private async handlePost(request: Request, pathname: string): Promise<Response> {
    if (pathname === "/start") {
      const input = StartRunInputSchema.parse(await request.json());
      return this.start(input);
    }
    if (pathname === "/takeover-state") {
      const input = TakeoverStateInputSchema.parse(await request.json());
      saveTakeoverStateInStorage(this.ctx, input);
      return Response.json({ ok: true });
    }
    if (pathname === "/resume-takeover") {
      const input = ResumeTakeoverInputSchema.parse(await request.json());
      consumeTakeoverStateInStorage(this.ctx, input);
      return Response.json({ ok: true });
    }
    if (pathname === "/cancel") {
      const userId = this.readInternalUser(request);
      return userId ? this.cancel(userId) : missingInternalUserResponse("cancel");
    }
    if (pathname === "/approval") {
      const userId = this.readInternalUser(request);
      if (!userId) {
        return missingInternalUserResponse("approval");
      }
      const body = ApprovalDecisionInputSchema.parse(await request.json());
      return this.approval(userId, body);
    }
    if (pathname === "/delete-all") {
      const userId = this.readInternalUser(request);
      return userId ? this.deleteAllState(userId) : missingInternalUserResponse("delete-all");
    }
    return new Response("Not found", { status: 404 });
  }

  private stream(request: Request, url: URL): Response {
    const lastSeq = parseLastSeqParam(url.searchParams.get("lastSeq"));
    if (lastSeq === null) {
      return new APIError(400, "invalid_query_param", "Invalid resume cursor", {
        hint: "Pass lastSeq as a non-negative integer.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    const userId = this.readInternalUser(request);
    return userId ? this.resume(userId, lastSeq) : missingInternalUserResponse("streams");
  }

  private readInternalUser(request: Request): string | null {
    return request.headers.get(INTERNAL_USER_HEADER);
  }

  private start(input: StartRunInput): Response {
    if (hasActiveRun(this.getStatus())) {
      if (this.getOwnerUserId() !== input.userId) {
        return new APIError(403, "permission_denied", "Run ownership mismatch", {
          hint: "Open the thread from the account that started the active run.",
          retriable: false,
        }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
      }
      return new APIError(409, "conflict_run_already_active", "An agent run is already active", {
        hint: "Wait for the current run to finish before starting another run on this thread.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    this.resetForNewRun();
    this.cancelRequested = false;
    this.setRunIdentity(input);
    this.setOwnerUserId(input.userId);
    this.setStatus("running");
    const stream = this.resumeStream(0);
    const abortController = new AbortController();
    this.activeRunAbortController = abortController;
    this.ctx.waitUntil(this.run(input, abortController));
    return createAgentStreamResponse({
      status: 202,
      stream,
    });
  }

  private resume(userId: string, lastSeq: number): Response {
    const ownerUserId = this.getOwnerUserId();
    if (!ownerUserId && !this.hasReplayRows(lastSeq) && !hasActiveRun(this.getStatus())) {
      return new Response(null, { status: 204 });
    }
    if (ownerUserId !== userId) {
      return new APIError(403, "permission_denied", "Run ownership mismatch", {
        hint: "Open the thread from the account that started the run.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    if (!this.hasReplayRows(lastSeq) && !hasActiveRun(this.getStatus())) {
      return new Response(null, { status: 204 });
    }
    return createAgentStreamResponse({
      stream: this.resumeStream(lastSeq),
    });
  }

  private status(userId: string): Response {
    const ownerUserId = this.getOwnerUserId();
    if (ownerUserId !== userId) {
      return new APIError(403, "permission_denied", "Run ownership mismatch", {
        hint: "Open the thread from the account that started the run.",
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    const runId = getRunStateValue(this.ctx, "run_id");
    if (!runId) {
      return new Response(null, { status: 204 });
    }
    const status = this.snapshotStatus();
    return Response.json(
      RunStatusSnapshotSchema.parse(
        agentRunStatusPayload({
          ctx: this.ctx,
          replayRows: this.replayRows(0),
          runId,
          status,
        }),
      ),
    );
  }

  private async deleteAllState(userId: string): Promise<Response> {
    const ownerUserId = this.getOwnerUserId();
    if (ownerUserId && ownerUserId !== userId) {
      return new APIError(403, "permission_denied", "Run ownership mismatch", {
        retriable: false,
      }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
    }
    await this.ctx.storage.deleteAll();
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
    await this.approvals.cancelPending();
    this.cancelRequested = true;
    this.activeRunAbortController?.abort(new Error("run canceled"));
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
    await this.append({ type: "finish", finishReason: "stop" }, { allowAfterCancelRequest: true });
    this.setStatus("canceled");
    await this.persistStoredRunStatus("canceled", {
      message: "Run canceled by user.",
      type: "run_canceled",
    });
    this.closeSubscribers();
    return Response.json({ ok: true });
  }

  private resumeStream(lastSeq: number): ReadableStream<UIMessageChunk> {
    let subscriber: Subscriber | undefined;
    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const status = this.getStatus();
        const rows = this.replayRows(lastSeq);
        for (const row of rows) {
          if (isMessagePartRow(row)) {
            this.write(controller, parseSequencedChunk(row));
          }
        }
        if (hasActiveRun(status)) {
          subscriber = { controller };
          this.subscribers.add(subscriber);
          return;
        }
        controller.close();
      },
      cancel: () => {
        if (subscriber) {
          this.subscribers.delete(subscriber);
          if (this.subscribers.size === 0) emitRunAbandoned(this.ctx, this.env);
        }
      },
    });
  }

  private async run(input: StartRunInput, abortController: AbortController): Promise<void> {
    const logger = createLogger({ threadId: input.threadId, userId: input.userId });
    logger.info("agent_run_started", { mastra_agent_ready: Boolean(mastra.getAgent("general")) });
    // Answer text is streamed as SEGMENTS, not one envelope: each contiguous run of
    // model narration opens its own text part, and a tool/thought row closes it. The
    // trailing segment is the model's final answer; the earlier ones are the
    // step-by-step working the transcript folds into the activity disclosure. Segments
    // open lazily (openAnswerSegmentId), so there is no run-start text-start here.
    this.openAnswerSegmentId = null;
    this.answerSegmentCount = 0;
    this.lastVisibleWasAnswerText = false;
    this.sawPreviewUrl = false;
    this.sawArtifact = false;
    const sandbox = this.env.PROJECT_SANDBOX.get(
      this.env.PROJECT_SANDBOX.idFromName(input.sandboxName),
    );
    let runLeaseOpened = false;

    try {
      await this.persistRunStatus(input, "running");
      await this.append({ type: "start" });
      await appendBudgetStatus(this.accountingDeps(), input, ZERO_BUDGET_SNAPSHOT);
      await this.append(runPlanChunk());
      if (input.quotaWarning) {
        await this.append({ type: "data-quota", data: { v: 1, ...input.quotaWarning } });
      }
      const startupCostCap = costCapExhaustion(input, MINIMUM_RUN_BUDGET_USD);
      if (startupCostCap) {
        await appendCostCapExhausted(this.accountingDeps(), input, startupCostCap);
        await persistAssistantMessage({ env: this.env, input, logger, rows: this.replayRows(0) });
        return;
      }
      // Sandbox startup is status chrome (Computer panel + run stage), never
      // visible answer prose — the model owns the transcript from its first token.
      await this.append({
        type: "data-sandbox-status",
        data: { v: 1, status: "starting" },
      });
      this.setRunStage("Preparing project sandbox.");

      // Open the active-run lease BEFORE any long sandbox work: pins
      // autoStopInterval=0 + schedules the keepalive alarm so the 15-min idle
      // auto-stop can't kill a long run/dev server, and seeds the lifecycle
      // metering checkpoint so sandbox-hours actually accrue. Released in finally.
      await sandbox.beginRun(input.runId);
      runLeaseOpened = true;
      await restoreBestEffortSnapshot(input, sandbox, this.env, logger);
      if (this.isRunCanceled()) {
        return;
      }
      await this.append(runTaskStatusChunk("prepare-sandbox", "completed"));
      await this.append(runTaskStatusChunk("run-agent", "running"));
      const runPath = await this.executeRunPath(input, sandbox, logger, abortController.signal);
      if (runPath === "completed" || this.isRunCanceled()) {
        return;
      }
      await this.append(runTaskStatusChunk("run-agent", "completed"));
      await this.append(runTaskStatusChunk("stream-results", "running"));
      await this.append({
        type: "data-sandbox-status",
        data: { v: 1, status: "ready" },
      });
      const sandboxBudget = await recordBudgetDelta(this.accountingDeps(), input, {
        kind: "sandbox_minimum",
        tokensIn: 0,
        tokensOut: 0,
        usd: MINIMUM_RUN_BUDGET_USD,
      });
      await enforceCostCaps(this.accountingDeps(), input, sandboxBudget);
      await this.append(runTaskStatusChunk("stream-results", "completed"));
      await this.appendClosingBackstop();
      await this.ensureAnswerSegmentEnded();
      await this.append({ type: "finish", finishReason: "stop" });
      this.setStatus("completed");
      await persistAssistantMessage({ env: this.env, input, logger, rows: this.replayRows(0) });
      await this.persistRunStatus(input, "completed");
      this.closeSubscribers();
    } catch (error) {
      if (this.isRunCanceled()) {
        return;
      }
      if (isCostCapAPIError(error)) {
        await persistAssistantMessage({ env: this.env, input, logger, rows: this.replayRows(0) });
        return;
      }
      const streamError = toAgentRunStreamError(error);
      logger.error("agent_run_failed", {
        code: streamError.code,
        error: streamError.message,
        retriable: streamError.retriable,
      });
      await this.append({
        type: "data-sandbox-status",
        data: { v: 1, status: "failed" },
      });
      await this.append(runTaskStatusChunk("run-agent", "failed", streamError.message));
      await this.append(runTaskStatusChunk("stream-results", "failed", streamError.message));
      await this.append({
        type: "data-error",
        data: {
          v: 1,
          code: streamError.code,
          message: streamError.message,
          retriable: streamError.retriable,
        },
      });
      await this.ensureAnswerSegmentEnded();
      await this.append({ type: "finish", finishReason: "error" });
      this.setStatus("failed");
      await persistAssistantMessage({ env: this.env, input, logger, rows: this.replayRows(0) });
      await this.persistRunStatus(input, "failed", {
        message: streamError.message,
        type: streamError.code,
      });
      this.closeSubscribers();
    } finally {
      if (runLeaseOpened) {
        // Release the lease: restores the idle auto-stop + closes the metering
        // checkpoint. Best-effort — the keepalive alarm reaps stale leases.
        await sandbox.endRun(input.runId).catch(() => undefined);
      }
      if (this.activeRunAbortController === abortController) {
        this.activeRunAbortController = undefined;
      }
    }
  }

  private async executeRunPath(
    input: StartRunInput,
    sandbox: ProjectSandboxStub,
    logger: ReturnType<typeof createLogger>,
    abortSignal: AbortSignal,
  ): Promise<"completed" | "continue"> {
    const directRunCodeInput = directRunCodeInputFromPrompt(input.messageText);
    if (directRunCodeInput) {
      await runDirectRunCode(
        {
          append: (chunk) => this.append(chunk),
          artifacts: this.createArtifactRuntime(input),
          logger,
          sandbox,
          setRunStage: (stage) => this.setRunStage(stage),
          // Slug-less fallback is "/workspace/app" so the dev-server slot matches wake/status/console.
          workspaceDir: input.workspaceSlug
            ? `/workspace/${input.workspaceSlug}`
            : "/workspace/app",
        },
        directRunCodeInput,
      );
      if (this.isRunCanceled()) {
        return "completed";
      }
      return "continue";
    }
    // Guarantee the project's folder exists before either path streams, so the general agent's
    // (system-forced) /workspace/<slug> cwd + dev server land in a real directory and the
    // slug-scoped code-server isn't left staring at a missing workspace.
    await this.ensureProjectWorkspaceDir(input, sandbox, logger);
    if (
      input.projectMode === "app-builder" ||
      input.projectMode === "app-builder-mobile" ||
      isAppBuilderRequest(input.messageText)
    ) {
      return this.executeAppBuilderRunPath(input, sandbox, logger, abortSignal);
    }
    await streamMastraRunWithFallback(this.streamDriverDeps(), {
      abortSignal,
      input,
      logger,
      sandbox,
    });
    if (this.isRunCanceled()) {
      return "completed";
    }
    return "continue";
  }

  // Best-effort `mkdir -p /workspace/<slug>` at run start. Idempotent; a failure only logs (the
  // tool calls that follow surface any real filesystem problem). No-op for slug-less legacy runs.
  private async ensureProjectWorkspaceDir(
    input: StartRunInput,
    sandbox: ProjectSandboxStub,
    logger: ReturnType<typeof createLogger>,
  ): Promise<void> {
    if (!input.workspaceSlug || !sandbox.exec) {
      return;
    }
    try {
      await sandbox.exec({
        command: ["mkdir", "-p", `/workspace/${input.workspaceSlug}`],
        timeoutMs: 15_000,
      });
    } catch (error) {
      logger.warn("workspace_dir_ensure_failed", {
        error: error instanceof Error ? error.message : String(error),
        workspaceSlug: input.workspaceSlug,
      });
    }
  }

  private async executeAppBuilderRunPath(
    input: StartRunInput,
    sandbox: ProjectSandboxStub,
    logger: ReturnType<typeof createLogger>,
    abortSignal: AbortSignal,
  ): Promise<"completed" | "continue"> {
    await warmSandbox(sandbox, logger);
    if (this.isRunCanceled()) {
      return "completed";
    }
    const { agentContextNote } = await runAppBuilder({
      append: (chunk) => this.append(chunk),
      env: this.env,
      input,
      logger,
      sandbox,
      setRunStage: (stage) => this.setRunStage(stage),
    });
    if (this.isRunCanceled()) {
      return "completed";
    }
    await streamMastraRunWithFallback(this.streamDriverDeps(), {
      abortSignal,
      ...(agentContextNote === undefined ? {} : { agentContextNote }),
      input,
      logger,
      sandbox,
    });
    if (this.isRunCanceled()) {
      return "completed";
    }
    // Mobile Metro can't watch the model's sandbox file edits, so restart it once the edit
    // stream is done to re-crawl the finished app onto the (unchanged) preview URL. Web/Next.js
    // hot-reloads via polling and needs no restart.
    if (input.projectMode === "app-builder-mobile") {
      // Best-effort: the answer already streamed and the preview URL is stable, so a transient
      // Daytona control-plane error here must not flip an already-successful mobile run to failed.
      try {
        await restartMobilePreview({
          append: (chunk) => this.append(chunk),
          env: this.env,
          input,
          logger,
          sandbox,
          setRunStage: (stage) => this.setRunStage(stage),
        });
      } catch (error) {
        logger.warn("mobile_preview_restart_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await snapshotAppBuilderWorkspace({
      env: this.env,
      input,
      logger,
      sandbox,
    });
    return "continue";
  }

  private streamDriverDeps(): StreamDriverDeps {
    return {
      append: (chunk) => this.append(chunk),
      appendCheckedMastraChunk: (input, chunk) => this.appendCheckedMastraChunk(input, chunk),
      createArtifactRuntime: (input) => this.createArtifactRuntime(input),
      createBroker: () => this.approvals.createBroker(),
      env: this.env,
      hasPendingDecision: () => this.approvals.hasPendingDecision(),
      persistResolvedCredential: (credential) => this.persistResolvedCredential(credential),
      setRunStage: (stage) => this.setRunStage(stage),
    };
  }

  private persistResolvedCredential(credential: LlmCredential): void {
    setRunStateValue(this.ctx, "credit_source", credential.creditSource);
    // DeepSeek runs (free or BYOK) carry the bare provider id; persist the catalog/accounting
    // slug so usage attribution matches the catalog format even for Auto-resolved runs.
    if (credential.provider === "deepseek") {
      setRunStateValue(this.ctx, "resolved_model_id", `deepseek/${credential.modelId}`);
    }
    if (
      credential.creditSource === "platform_free" &&
      credential.freeTokensUsedAtResolve !== undefined
    ) {
      setRunStateValue(
        this.ctx,
        "free_deepseek_start_used",
        String(credential.freeTokensUsedAtResolve),
      );
    }
  }

  private async appendMastraChunk(chunk: unknown): Promise<number> {
    let appendedCount = 0;
    for (const uiChunk of mastraChunkToUiChunks(chunk)) {
      appendedCount += await this.appendAnswerSegmented(uiChunk);
    }
    return appendedCount;
  }

  /**
   * Streams model output as answer SEGMENTS: a contiguous run of text-deltas becomes
   * one text part, and any activity row (a tool call or a thought) closes it so the
   * next run starts a fresh part. The transcript folds every segment except the
   * trailing one into the activity disclosure and shows the last as the final answer.
   */
  private async appendAnswerSegmented(uiChunk: UIMessageChunk): Promise<number> {
    if (uiChunk.type === "text-delta") {
      this.lastVisibleWasAnswerText = true;
      let count = 0;
      if (this.openAnswerSegmentId === null) {
        this.openAnswerSegmentId = `answer-${this.answerSegmentCount}`;
        this.answerSegmentCount += 1;
        await this.append({ type: "text-start", id: this.openAnswerSegmentId });
        count += 1;
      }
      await this.append({ ...uiChunk, id: this.openAnswerSegmentId });
      return count + 1;
    }
    if (ANSWER_SEGMENT_BREAK_TYPES.has(uiChunk.type)) {
      this.lastVisibleWasAnswerText = false;
      const closed = await this.ensureAnswerSegmentEnded();
      await this.append(uiChunk);
      return closed + 1;
    }
    await this.append(uiChunk);
    return 1;
  }

  /** Notes whether a preview or downloadable deliverable appeared (drives the closing backstop). */
  private trackClosingSignals(uiChunk: UIMessageChunk): void {
    if (uiChunk.type === "data-artifact") {
      this.sawArtifact = true;
      return;
    }
    if (uiChunk.type === "data-sandbox-status") {
      const data = (uiChunk as { data?: { previewUrl?: unknown } }).data;
      if (typeof data?.previewUrl === "string" && data.previewUrl.length > 0) {
        this.sawPreviewUrl = true;
      }
    }
  }

  /**
   * Guarantees the run closes with a message. Models sometimes end their turn on a bare
   * verification tool call (e.g. opening the preview) without writing a summary, which
   * would leave the transcript with no answer and force the user to re-prompt. When that
   * happens, append a short closing that points at the deliverable the run produced.
   */
  private async appendClosingBackstop(): Promise<void> {
    if (this.lastVisibleWasAnswerText) {
      return;
    }
    const closing = this.sawPreviewUrl
      ? "Done — your app is built and running. Open the live preview in the Computer panel to see it, and tell me what you'd like to change."
      : this.sawArtifact
        ? "Done — your file is ready to download from the deliverables above. Let me know if you'd like any changes."
        : "Done — I've finished the work; you can review it in the Computer panel. Let me know if you'd like any changes.";
    await this.appendAnswerSegmented({ type: "text-delta", id: "answer", delta: closing });
  }

  /** Closes the open answer text segment (if any). Returns chunks appended (0 or 1). */
  private async ensureAnswerSegmentEnded(): Promise<number> {
    if (this.openAnswerSegmentId === null) {
      return 0;
    }
    const id = this.openAnswerSegmentId;
    this.openAnswerSegmentId = null;
    await this.append({ type: "text-end", id });
    return 1;
  }

  private accountingDeps(): BudgetAccountingDeps {
    return {
      append: (chunk) => this.append(chunk),
      closeSubscribers: () => this.closeSubscribers(),
      ctx: this.ctx,
      endOpenAnswerText: async () => {
        await this.ensureAnswerSegmentEnded();
      },
      env: this.env,
      markCompleted: async (input) => {
        this.setStatus("completed");
        await this.persistRunStatus(input, "completed");
      },
    };
  }

  private async appendCheckedMastraChunk(input: StartRunInput, chunk: unknown): Promise<number> {
    const streamError = mastraChunkError(chunk);
    if (streamError) {
      throw normalizeMastraStreamError(streamError);
    }
    emitMastraChunkTelemetry(this.ctx, this.env, input, chunk);
    const appendedCount = await this.appendMastraChunk(chunk);
    const usage = usageFromMastraChunk(chunk);
    if (usage) {
      const snapshot = await recordBudgetDelta(this.accountingDeps(), input, {
        kind: "llm_usage",
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        usd: usage.costUsd ?? 0,
      });
      await enforceCostCaps(this.accountingDeps(), input, snapshot);
      await enforceFreeDeepseekCap(this.accountingDeps(), input, snapshot);
    }
    return appendedCount;
  }

  private createArtifactRuntime(input: StartRunInput): ArtifactRuntime {
    return {
      put: async (artifact) => storeAgentArtifact({ artifact, env: this.env, input }),
    };
  }

  private async append(
    chunk: UIMessageChunk,
    options?: { allowAfterCancelRequest?: boolean },
  ): Promise<void> {
    if (this.isRunCanceled() && !options?.allowAfterCancelRequest) {
      return;
    }
    // Central point every chunk flows through (model stream AND app-builder harness), so
    // the closing backstop notices a preview/deliverable no matter which path emitted it.
    this.trackClosingSignals(chunk);
    const sequencedChunk = { chunk, seq: appendAgentRunMessagePart(this.ctx, chunk) };
    emitFirstVisibleChunkMetric(this.ctx, this.env, chunk);
    for (const subscriber of this.subscribers) {
      this.write(subscriber.controller, sequencedChunk);
    }
  }

  private write(
    controller: ReadableStreamDefaultController<UIMessageChunk>,
    sequencedChunk: { chunk: UIMessageChunk; seq: number },
  ): void {
    controller.enqueue(sequencedChunk.chunk);
    controller.enqueue(createSeqChunk(sequencedChunk.seq));
  }

  private closeSubscribers(): void {
    for (const subscriber of this.subscribers) {
      subscriber.controller.close();
      this.subscribers.delete(subscriber);
    }
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

  /** Flips both the DO run state and the Postgres row (run-control §2.2). */
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

  /** DO eviction mid-approval: fail the run deterministically (run-control §2.4). */
  private async finalizeUnrecoverableApproval(): Promise<void> {
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
    this.setStatus("failed");
    const identity = this.runIdentity();
    if (identity) {
      await persistAssistantMessageForIdentity({
        env: this.env,
        logger: createLogger({ runId: identity.runId, userId: identity.userId }),
        rows: this.replayRows(0),
        runId: identity.runId,
        threadId: identity.threadId,
        userId: identity.userId,
      });
      await this.persistRunStatusById({
        error: { message: "Pending approval was unrecoverable.", type: "approval_unrecoverable" },
        runId: identity.runId,
        status: "failed",
        userId: identity.userId,
      });
    }
    this.closeSubscribers();
  }

  private setRunIdentity(input: StartRunInput): void {
    setRunStateValue(this.ctx, "run_id", input.runId);
    setRunStateValue(this.ctx, "thread_id", input.threadId);
    setRunStateValue(this.ctx, "project_id", input.projectId);
    if (input.isFirstRun) setRunStateValue(this.ctx, "is_first_run", "true");
    upsertRunRow(this.ctx, input);
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
    this.ctx.storage.sql.exec("DELETE FROM budget_event");
    this.ctx.storage.sql.exec("DELETE FROM message_part");
    this.ctx.storage.sql.exec("DELETE FROM run");
    this.ctx.storage.sql.exec("DELETE FROM run_state");
  }

  private hasReplayRows(lastSeq: number): boolean {
    return this.replayRows(lastSeq).some(isMessagePartRow);
  }

  private replayRows(lastSeq: number): unknown[] {
    return this.ctx.storage.sql
      .exec("SELECT seq, payload_json FROM message_part WHERE seq > ? ORDER BY seq", lastSeq)
      .toArray();
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

  private persistRunStatusById(input: {
    error?: { message: string; type: string };
    runId: string;
    status: PersistableRunStatus;
    userId: string;
  }): Promise<void> {
    emitStoredAgentRunMetric(this.ctx, this.env, input);
    return persistAgentRunStatus(this.env, input);
  }
}
