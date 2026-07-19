import { APIError, createLogger } from "@cheatcode/observability";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";
import {
  deleteRunStateValues,
  getRunStateTimestamp,
  getRunStateValue,
  isAgentRunDeleted,
  setRunStateValue,
} from "./agent-run-storage";
import { admitAgentRunWorkflow } from "./agent-run-workflow";
import { agentRunExecutionEpochResponse } from "./agent-run-workflow-epoch";
import {
  AGENT_RUN_EXECUTION_EPOCH_MS,
  AGENT_RUN_EXECUTION_LEASE_GRACE_MS,
  AGENT_RUN_WORKFLOW_ADMITTED_KEY,
  AGENT_RUN_WORKFLOW_EXECUTION_STARTED_KEY,
  AGENT_RUN_WORKFLOW_GENERATION_KEY,
  AGENT_RUN_WORKFLOW_ID_KEY,
  AGENT_RUN_WORKFLOW_INPUT_HASH_KEY,
  AGENT_RUN_WORKFLOW_LEASE_EXPIRES_AT_KEY,
  AGENT_RUN_WORKFLOW_PENDING_INPUT_KEY,
  AGENT_RUN_WORKFLOW_RETRY_AT_KEY,
  AGENT_RUN_WORKFLOW_RETRY_ATTEMPT_KEY,
  AGENT_RUN_WORKFLOW_RETRY_BASE_MS,
  AGENT_RUN_WORKFLOW_RETRY_MAX_MS,
  type AgentRunWorkflowCallbackInput,
  type AgentRunWorkflowFailureInput,
  type AgentRunWorkflowPayload,
  AgentRunWorkflowPayloadSchema,
  type AgentRunWorkflowRolloverResult,
  agentRunWorkflowInputHash,
  agentRunWorkflowInstanceId,
} from "./agent-run-workflow-protocol";
import { hasActiveRun } from "./run-state";

interface AgentRunWorkflowControllerDeps {
  armAlarm: () => Promise<void>;
  ctx: DurableObjectState;
  env: AgentRunEnv;
  finalizeOwnershipFailure: (message: string) => Promise<void>;
  getStatus: () => string | undefined;
  run: (input: StartRunInput, abortController: AbortController) => Promise<void>;
}

/** Durable Workflow admission and retry-safe execution ownership for one run-keyed DO. */
export class AgentRunWorkflowController {
  private activeAbortController: AbortController | undefined;
  private activeRunPromise: Promise<void> | undefined;

  public constructor(private readonly deps: AgentRunWorkflowControllerDeps) {}

  public createAdmission(input: StartRunInput): Promise<AgentRunWorkflowPayload> {
    return this.payloadFor(input);
  }

  /** Ensures a crash immediately after the run claim cannot strand pending admission. */
  public armAdmissionRecovery(): Promise<void> {
    return this.deps.ctx.storage.setAlarm(Date.now() + AGENT_RUN_WORKFLOW_RETRY_BASE_MS);
  }

  /** Atomically couples the DO run claim to its pending durable Workflow owner. */
  public claimAdmission(payload: AgentRunWorkflowPayload, claimRun: () => void): void {
    const parsed = AgentRunWorkflowPayloadSchema.parse(payload);
    const workflowId = agentRunWorkflowInstanceId(parsed.input.runId, parsed.generation);
    this.deps.ctx.storage.transactionSync(() => {
      claimRun();
      this.writePendingAdmission(parsed, workflowId);
    });
  }

  public async admit(payload: AgentRunWorkflowPayload): Promise<void> {
    const parsed = AgentRunWorkflowPayloadSchema.parse(payload);
    const workflowId = agentRunWorkflowInstanceId(parsed.input.runId, parsed.generation);
    if (getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) === "true") {
      this.assertExpectedIdentity(parsed.inputHash, workflowId, parsed.generation);
      await this.ensureAdmissionLease();
      return;
    }
    this.assertPendingAdmission(parsed, workflowId);
    if (getRunStateTimestamp(this.deps.ctx, AGENT_RUN_WORKFLOW_RETRY_AT_KEY) === null) {
      await this.deps.armAlarm();
      return;
    }
    await this.deps.armAlarm();
    try {
      await this.admitPendingPayload(parsed, workflowId);
    } catch (error) {
      await this.recordAdmissionFailure();
      throw error;
    }
  }

  public async reconcileAdmission(): Promise<void> {
    if (!getRunStateValue(this.deps.ctx, "run_id")) {
      return;
    }
    if (getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) === "true") {
      await this.ensureAdmissionLease();
      return;
    }
    const payload = this.pendingPayload();
    const expectedId = agentRunWorkflowInstanceId(payload.input.runId, payload.generation);
    if (getRunStateTimestamp(this.deps.ctx, AGENT_RUN_WORKFLOW_RETRY_AT_KEY) === null) {
      await this.deps.armAlarm();
      return;
    }
    try {
      await this.admitPendingPayload(payload, expectedId);
    } catch (error) {
      await this.recordAdmissionFailure();
      throw error;
    }
  }

  /** Alarm-owned retry for a start whose deterministic Workflow admission was ambiguous. */
  public async recoverPendingAdmission(): Promise<boolean> {
    if (
      !hasActiveRun(this.deps.getStatus()) ||
      getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) === "true"
    ) {
      return false;
    }
    const retryAt = getRunStateTimestamp(this.deps.ctx, AGENT_RUN_WORKFLOW_RETRY_AT_KEY);
    if (retryAt === null || retryAt > Date.now()) {
      return false;
    }
    try {
      const payload = this.pendingPayload();
      await this.admitPendingPayload(
        payload,
        agentRunWorkflowInstanceId(payload.input.runId, payload.generation),
      );
      return true;
    } catch (error) {
      const runId = getRunStateValue(this.deps.ctx, "run_id");
      createLogger(runId ? { runId } : {}).warn("agent_run_workflow_admission_retry_failed", {
        error,
      });
      return this.rearmAdmissionFailure();
    }
  }

  public async executeEpoch(input: AgentRunWorkflowCallbackInput): Promise<Response> {
    if (isAgentRunDeleted(this.deps.ctx)) {
      return Response.json({ outcome: "deleted", status: "deleted" });
    }
    const status = this.deps.getStatus();
    if (!hasActiveRun(status)) {
      return Response.json({ outcome: "terminal", status: status ?? "unknown" });
    }
    const identity = await this.promoteExecutionOwner(input);
    if (identity.outcome !== "current") {
      return Response.json({ outcome: identity.outcome, status: identity.status });
    }
    if (!this.activeRunPromise) {
      if (getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_EXECUTION_STARTED_KEY)) {
        return this.failInterruptedExecution();
      }
      setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_EXECUTION_STARTED_KEY, String(Date.now()));
      this.startExecution(input.input);
    }
    const runPromise = this.activeRunPromise;
    if (!runPromise) {
      throw new Error("AgentRun execution promise disappeared after admission.");
    }
    // The Workflow response is the durable owner. waitUntil only bridges the short
    // checkpoint gap before the next Workflow epoch attaches to this same promise.
    this.deps.ctx.waitUntil(runPromise);
    await this.renewLease();
    return agentRunExecutionEpochResponse({
      getStatus: this.deps.getStatus,
      isDeleted: () => isAgentRunDeleted(this.deps.ctx),
      runPromise,
    });
  }

  public async failWorkflow(input: AgentRunWorkflowFailureInput): Promise<Response> {
    const status = this.deps.getStatus();
    if (isAgentRunDeleted(this.deps.ctx) || !hasActiveRun(status)) {
      return Response.json({ ok: true });
    }
    if (this.callbackGeneration(input) === "stale") {
      return Response.json({ ok: true });
    }
    this.abort(new Error("AgentRun Workflow ownership failed"));
    await this.join();
    await this.deps.finalizeOwnershipFailure(input.message);
    return Response.json({ ok: true });
  }

  public async reserveSuccessor(input: AgentRunWorkflowCallbackInput): Promise<Response> {
    if (isAgentRunDeleted(this.deps.ctx)) {
      return Response.json({ outcome: "deleted", status: "deleted" });
    }
    const status = this.deps.getStatus();
    if (!hasActiveRun(status)) {
      return Response.json({ outcome: "terminal", status: status ?? "unknown" });
    }
    await this.assertPayloadIdentity(input);
    const result = this.reserveSuccessorState(input);
    if (result.outcome === "reserved") {
      const runPromise = this.activeRunPromise;
      if (runPromise !== undefined) {
        this.deps.ctx.waitUntil(runPromise);
      }
      await this.deps.armAlarm();
    }
    return Response.json(result);
  }

  public async handleExpiredLease(): Promise<boolean> {
    const expiresAt = getRunStateTimestamp(this.deps.ctx, AGENT_RUN_WORKFLOW_LEASE_EXPIRES_AT_KEY);
    if (!hasActiveRun(this.deps.getStatus()) || expiresAt === null || expiresAt > Date.now()) {
      return false;
    }
    this.abort(new Error("AgentRun Workflow execution lease expired"));
    await this.join();
    await this.deps.finalizeOwnershipFailure(
      "Durable execution ownership was interrupted. Send the prompt again to retry.",
    );
    return true;
  }

  public abort(reason: Error): void {
    const runPromise = this.activeRunPromise;
    this.activeAbortController?.abort(reason);
    if (runPromise !== undefined) {
      this.deps.ctx.waitUntil(runPromise.catch(() => undefined));
    }
  }

  public async join(): Promise<void> {
    await this.activeRunPromise?.catch(() => undefined);
  }

  private async payloadFor(input: StartRunInput): Promise<AgentRunWorkflowPayload> {
    const storedRunId = getRunStateValue(this.deps.ctx, "run_id");
    const generation = storedRunId === input.runId ? this.currentGeneration() : 0;
    return AgentRunWorkflowPayloadSchema.parse({
      generation,
      input,
      inputHash: await agentRunWorkflowInputHash(input),
    });
  }

  private async promoteExecutionOwner(input: AgentRunWorkflowCallbackInput): Promise<{
    outcome: "continued" | "current" | "deleted" | "terminal";
    status: string;
  }> {
    await this.assertPayloadIdentity(input);
    if (isAgentRunDeleted(this.deps.ctx)) {
      return { outcome: "deleted", status: "deleted" };
    }
    const status = this.deps.getStatus();
    if (!status || !hasActiveRun(status)) {
      return { outcome: "terminal", status: status ?? "unknown" };
    }
    if (this.callbackGeneration(input) === "stale") {
      return { outcome: "continued", status };
    }
    this.promoteAdmission(input.inputHash, input.workflowInstanceId, input.generation);
    return { outcome: "current", status };
  }

  private async assertPayloadIdentity(input: AgentRunWorkflowPayload): Promise<void> {
    if ((await agentRunWorkflowInputHash(input.input)) !== input.inputHash) {
      throw ownershipConflict("AgentRun Workflow input hash mismatch.");
    }
    if (input.input.runId !== getRunStateValue(this.deps.ctx, "run_id")) {
      throw ownershipConflict("AgentRun Workflow run identity mismatch.");
    }
  }

  private assertExpectedIdentity(
    inputHash: string,
    workflowInstanceId: string,
    generation: number,
  ): void {
    if (
      getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) !== "true" ||
      !this.hasStoredIdentity(inputHash, workflowInstanceId, generation)
    ) {
      throw ownershipConflict("AgentRun Workflow ownership identity mismatch.");
    }
  }

  private assertStoredIdentity(
    inputHash: string,
    workflowInstanceId: string,
    generation: number,
  ): void {
    if (!this.hasStoredIdentity(inputHash, workflowInstanceId, generation)) {
      throw ownershipConflict("AgentRun Workflow ownership identity mismatch.");
    }
  }

  private promoteAdmission(
    inputHash: string,
    workflowInstanceId: string,
    generation: number,
  ): void {
    this.deps.ctx.storage.transactionSync(() => {
      this.assertStoredIdentity(inputHash, workflowInstanceId, generation);
      if (getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) !== "true") {
        const pending = AgentRunWorkflowPayloadSchema.safeParse(
          safeJson(getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_PENDING_INPUT_KEY)),
        );
        if (
          !pending.success ||
          pending.data.generation !== generation ||
          pending.data.inputHash !== inputHash
        ) {
          throw ownershipConflict("AgentRun Workflow pending admission state is invalid.");
        }
        setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY, "true");
        deleteRunStateValues(this.deps.ctx, [
          AGENT_RUN_WORKFLOW_PENDING_INPUT_KEY,
          AGENT_RUN_WORKFLOW_RETRY_ATTEMPT_KEY,
          AGENT_RUN_WORKFLOW_RETRY_AT_KEY,
        ]);
      }
    });
  }

  private hasStoredIdentity(
    inputHash: string,
    workflowInstanceId: string,
    generation: number,
  ): boolean {
    return (
      getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ID_KEY) === workflowInstanceId &&
      getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_INPUT_HASH_KEY) === inputHash &&
      this.currentGeneration() === generation
    );
  }

  private writePendingAdmission(
    payload: AgentRunWorkflowPayload,
    workflowInstanceId: string,
  ): void {
    const now = Date.now();
    deleteRunStateValues(this.deps.ctx, [AGENT_RUN_WORKFLOW_ADMITTED_KEY]);
    setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_GENERATION_KEY, String(payload.generation));
    setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ID_KEY, workflowInstanceId);
    setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_INPUT_HASH_KEY, payload.inputHash);
    setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_PENDING_INPUT_KEY, JSON.stringify(payload));
    this.resetAdmissionTimers(now);
  }

  private assertPendingAdmission(
    payload: AgentRunWorkflowPayload,
    workflowInstanceId: string,
  ): void {
    this.assertStoredIdentity(payload.inputHash, workflowInstanceId, payload.generation);
    const pending = this.pendingPayload();
    if (pending.generation !== payload.generation || pending.inputHash !== payload.inputHash) {
      throw ownershipConflict("AgentRun Workflow pending admission identity mismatch.");
    }
  }

  private resetAdmissionTimers(now: number): void {
    setRunStateValue(
      this.deps.ctx,
      AGENT_RUN_WORKFLOW_LEASE_EXPIRES_AT_KEY,
      String(now + AGENT_RUN_EXECUTION_EPOCH_MS + AGENT_RUN_EXECUTION_LEASE_GRACE_MS),
    );
    setRunStateValue(
      this.deps.ctx,
      AGENT_RUN_WORKFLOW_RETRY_AT_KEY,
      String(now + AGENT_RUN_WORKFLOW_RETRY_BASE_MS),
    );
    setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_RETRY_ATTEMPT_KEY, "0");
  }

  private callbackGeneration(input: {
    generation: number;
    inputHash: string;
    workflowInstanceId: string;
  }): "current" | "stale" {
    const runId = getRunStateValue(this.deps.ctx, "run_id");
    if (
      !runId ||
      input.workflowInstanceId !== agentRunWorkflowInstanceId(runId, input.generation) ||
      getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_INPUT_HASH_KEY) !== input.inputHash
    ) {
      throw ownershipConflict("AgentRun Workflow callback identity mismatch.");
    }
    const currentGeneration = this.currentGeneration();
    if (
      getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ID_KEY) !==
      agentRunWorkflowInstanceId(runId, currentGeneration)
    ) {
      throw ownershipConflict("AgentRun Workflow current generation identity is inconsistent.");
    }
    if (currentGeneration > input.generation) {
      return "stale";
    }
    if (currentGeneration < input.generation) {
      throw ownershipConflict("AgentRun Workflow callback is from an unreserved generation.");
    }
    this.assertStoredIdentity(input.inputHash, input.workflowInstanceId, input.generation);
    return "current";
  }

  private reserveSuccessorState(
    input: AgentRunWorkflowCallbackInput,
  ): AgentRunWorkflowRolloverResult {
    return this.deps.ctx.storage.transactionSync(() => {
      if (isAgentRunDeleted(this.deps.ctx)) {
        return { outcome: "deleted", status: "deleted" };
      }
      const currentStatus = this.deps.getStatus();
      if (!currentStatus || !hasActiveRun(currentStatus)) {
        return { outcome: "terminal", status: currentStatus ?? "unknown" };
      }
      if (this.callbackGeneration(input) === "stale") {
        return this.replayedReservation(input, currentStatus);
      }
      if (getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) !== "true") {
        throw ownershipConflict("AgentRun Workflow rollover owner is not promoted.");
      }
      const payload = this.successorPayload(input);
      const workflowInstanceId = agentRunWorkflowInstanceId(
        payload.input.runId,
        payload.generation,
      );
      this.writePendingAdmission(payload, workflowInstanceId);
      return { outcome: "reserved", payload, status: currentStatus, workflowInstanceId };
    });
  }

  private replayedReservation(
    input: AgentRunWorkflowCallbackInput,
    status: string,
  ): AgentRunWorkflowRolloverResult {
    const payload = this.successorPayload(input);
    if (this.currentGeneration() !== payload.generation) {
      return { outcome: "continued", status };
    }
    const workflowInstanceId = agentRunWorkflowInstanceId(payload.input.runId, payload.generation);
    this.assertStoredIdentity(payload.inputHash, workflowInstanceId, payload.generation);
    if (getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) === "true") {
      return { outcome: "continued", status };
    }
    const pending = this.pendingPayload();
    if (pending.generation !== payload.generation || pending.inputHash !== payload.inputHash) {
      throw ownershipConflict("AgentRun Workflow successor reservation is inconsistent.");
    }
    return { outcome: "reserved", payload, status, workflowInstanceId };
  }

  private successorPayload(input: AgentRunWorkflowCallbackInput): AgentRunWorkflowPayload {
    const generation = input.generation + 1;
    if (!Number.isSafeInteger(generation)) {
      throw ownershipUnavailable("AgentRun Workflow generation cannot be represented safely.");
    }
    return AgentRunWorkflowPayloadSchema.parse({
      generation,
      input: input.input,
      inputHash: input.inputHash,
    });
  }

  private currentGeneration(): number {
    const raw = getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_GENERATION_KEY);
    const generation = raw === undefined ? Number.NaN : Number(raw);
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw ownershipConflict("AgentRun Workflow generation state is invalid.");
    }
    return generation;
  }

  private pendingPayload(): AgentRunWorkflowPayload {
    const raw = getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_PENDING_INPUT_KEY);
    const parsed = AgentRunWorkflowPayloadSchema.safeParse(safeJson(raw));
    if (!parsed.success) {
      throw ownershipUnavailable("AgentRun Workflow admission state is incomplete.");
    }
    return parsed.data;
  }

  private async admitPendingPayload(
    payload: AgentRunWorkflowPayload,
    expectedId: string,
  ): Promise<void> {
    this.assertStoredIdentity(payload.inputHash, expectedId, payload.generation);
    const admittedId = await admitAgentRunWorkflow(this.deps.env, payload);
    if (admittedId !== expectedId) {
      throw ownershipConflict("AgentRun Workflow admitted an unexpected instance id.");
    }
    if (
      !isAgentRunDeleted(this.deps.ctx) &&
      hasActiveRun(this.deps.getStatus()) &&
      this.hasStoredIdentity(payload.inputHash, admittedId, payload.generation)
    ) {
      deleteRunStateValues(this.deps.ctx, [
        AGENT_RUN_WORKFLOW_RETRY_ATTEMPT_KEY,
        AGENT_RUN_WORKFLOW_RETRY_AT_KEY,
      ]);
      await this.renewLease();
    }
  }

  private async recordAdmissionFailure(): Promise<void> {
    if (
      isAgentRunDeleted(this.deps.ctx) ||
      !hasActiveRun(this.deps.getStatus()) ||
      getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) === "true"
    ) {
      return;
    }
    this.scheduleAdmissionRetry();
    await this.deps.armAlarm();
  }

  private async rearmAdmissionFailure(): Promise<boolean> {
    if (isAgentRunDeleted(this.deps.ctx) || !hasActiveRun(this.deps.getStatus())) {
      return true;
    }
    if (getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) === "true") {
      await this.deps.armAlarm();
      return true;
    }
    const expiresAt = getRunStateTimestamp(this.deps.ctx, AGENT_RUN_WORKFLOW_LEASE_EXPIRES_AT_KEY);
    if (expiresAt === null) {
      this.resetAdmissionTimers(Date.now());
    } else if (expiresAt <= Date.now()) {
      return false;
    }
    this.scheduleAdmissionRetry();
    await this.deps.armAlarm();
    return true;
  }

  private scheduleAdmissionRetry(): void {
    this.deps.ctx.storage.transactionSync(() => {
      const now = Date.now();
      const rawAttempt = Number(
        getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_RETRY_ATTEMPT_KEY) ?? "0",
      );
      const attempt = Number.isSafeInteger(rawAttempt) && rawAttempt >= 0 ? rawAttempt : 0;
      const delay = Math.min(
        AGENT_RUN_WORKFLOW_RETRY_BASE_MS * 2 ** Math.min(attempt, 10),
        AGENT_RUN_WORKFLOW_RETRY_MAX_MS,
      );
      const expiresAt = getRunStateTimestamp(
        this.deps.ctx,
        AGENT_RUN_WORKFLOW_LEASE_EXPIRES_AT_KEY,
      );
      const failSafeAt =
        expiresAt ?? now + AGENT_RUN_EXECUTION_EPOCH_MS + AGENT_RUN_EXECUTION_LEASE_GRACE_MS;
      const retryAt = Math.min(now + delay, failSafeAt);
      setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_RETRY_ATTEMPT_KEY, String(attempt + 1));
      setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_RETRY_AT_KEY, String(retryAt));
    });
  }

  private startExecution(input: StartRunInput): void {
    const abortController = new AbortController();
    const runPromise = this.deps.run(input, abortController);
    this.activeAbortController = abortController;
    this.activeRunPromise = runPromise;
    void runPromise
      .finally(() => {
        if (this.activeRunPromise === runPromise) {
          this.activeAbortController = undefined;
          this.activeRunPromise = undefined;
        }
      })
      .catch(() => undefined);
  }

  private failInterruptedExecution(): Response {
    const failure = this.deps.finalizeOwnershipFailure(
      "Durable execution was interrupted before it finished. Send the prompt again to retry.",
    );
    return agentRunExecutionEpochResponse({
      getStatus: this.deps.getStatus,
      isDeleted: () => isAgentRunDeleted(this.deps.ctx),
      runPromise: failure,
    });
  }

  private async renewLease(): Promise<void> {
    setRunStateValue(
      this.deps.ctx,
      AGENT_RUN_WORKFLOW_LEASE_EXPIRES_AT_KEY,
      String(Date.now() + AGENT_RUN_EXECUTION_EPOCH_MS + AGENT_RUN_EXECUTION_LEASE_GRACE_MS),
    );
    await this.deps.armAlarm();
  }

  private async ensureAdmissionLease(): Promise<void> {
    if (getRunStateTimestamp(this.deps.ctx, AGENT_RUN_WORKFLOW_LEASE_EXPIRES_AT_KEY) === null) {
      await this.renewLease();
      return;
    }
    await this.deps.armAlarm();
  }
}

function safeJson(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function ownershipConflict(message: string): APIError {
  return new APIError(409, "conflict_state_invalid", message, { retriable: false });
}

function ownershipUnavailable(message: string): APIError {
  return new APIError(503, "unavailable_maintenance", message, {
    hint: "Retry the same run admission request.",
    retriable: true,
  });
}
