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
import {
  AGENT_RUN_WORKFLOW_ADMITTED_KEY,
  AGENT_RUN_WORKFLOW_ID_KEY,
  AGENT_RUN_WORKFLOW_INPUT_HASH_KEY,
  AGENT_RUN_WORKFLOW_PENDING_INPUT_KEY,
  AGENT_RUN_WORKFLOW_RECONCILE_AT_KEY,
  AGENT_RUN_WORKFLOW_RECONCILE_INTERVAL_MS,
  AGENT_RUN_WORKFLOW_RETRY_AT_KEY,
  AGENT_RUN_WORKFLOW_RETRY_ATTEMPT_KEY,
  AGENT_RUN_WORKFLOW_RETRY_BASE_MS,
  AGENT_RUN_WORKFLOW_RETRY_MAX_MS,
  AGENT_RUN_WORKFLOW_UNKNOWN_ATTEMPT_KEY,
  AGENT_RUN_WORKFLOW_UNKNOWN_ATTEMPT_LIMIT,
  type AgentRunWorkflowCallbackInput,
  type AgentRunWorkflowFailureInput,
  type AgentRunWorkflowPayload,
  AgentRunWorkflowPayloadSchema,
  agentRunWorkflowInputHash,
  agentRunWorkflowInstanceId,
} from "./agent-run-workflow-protocol";
import { hasActiveRun } from "./run-state";

interface AgentRunWorkflowControllerDeps {
  armAlarm: () => Promise<void>;
  ctx: DurableObjectState;
  env: AgentRunEnv;
  finalizeWorkflowFailure: (input: {
    code: string;
    message: string;
    retriable: boolean;
  }) => Promise<void>;
  getStatus: () => string | undefined;
}

type AgentRunWorkflowStatus = Awaited<ReturnType<WorkflowInstance["status"]>>["status"];

/** Admission, identity, and cancellation boundary for the Workflow-owned run. */
export class AgentRunWorkflowController {
  public constructor(private readonly deps: AgentRunWorkflowControllerDeps) {}

  public async createAdmission(input: StartRunInput): Promise<AgentRunWorkflowPayload> {
    return AgentRunWorkflowPayloadSchema.parse({
      input,
      inputHash: await agentRunWorkflowInputHash(input),
    });
  }

  public armAdmissionRecovery(): Promise<void> {
    return this.deps.ctx.storage.setAlarm(Date.now() + AGENT_RUN_WORKFLOW_RETRY_BASE_MS);
  }

  public claimAdmission(payload: AgentRunWorkflowPayload, claimRun: () => void): void {
    const parsed = AgentRunWorkflowPayloadSchema.parse(payload);
    this.deps.ctx.storage.transactionSync(() => {
      claimRun();
      this.writePendingAdmission(parsed);
    });
  }

  public async admit(payload: AgentRunWorkflowPayload): Promise<void> {
    const parsed = AgentRunWorkflowPayloadSchema.parse(payload);
    if (getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) === "true") {
      this.assertStoredIdentity(parsed.inputHash, agentRunWorkflowInstanceId(parsed.input.runId));
      return;
    }
    this.assertPendingAdmission(parsed);
    await this.admitPendingPayload(parsed).catch(async (error: unknown) => {
      await this.recordAdmissionFailure();
      throw error;
    });
  }

  public async reconcileAdmission(): Promise<void> {
    if (!hasActiveRun(this.deps.getStatus())) return;
    if (getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) === "true") {
      await this.reconcileAdmittedWorkflow();
      return;
    }
    const retryAt = getRunStateTimestamp(this.deps.ctx, AGENT_RUN_WORKFLOW_RETRY_AT_KEY);
    if (retryAt === null) {
      await this.deps.armAlarm();
      return;
    }
    if (retryAt > Date.now()) return;
    const payload = this.pendingPayload();
    await this.admitPendingPayload(payload).catch(async (error: unknown) => {
      await this.recordAdmissionFailure();
      throw error;
    });
  }

  public async recoverPendingAdmission(): Promise<boolean> {
    if (
      !hasActiveRun(this.deps.getStatus()) ||
      getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) === "true"
    ) {
      return false;
    }
    const retryAt = getRunStateTimestamp(this.deps.ctx, AGENT_RUN_WORKFLOW_RETRY_AT_KEY);
    if (retryAt === null || retryAt > Date.now()) return false;
    try {
      await this.admitPendingPayload(this.pendingPayload());
      return true;
    } catch (error) {
      const runId = getRunStateValue(this.deps.ctx, "run_id");
      createLogger(runId ? { runId } : {}).warn("agent_run_workflow_admission_retry_failed", {
        error,
      });
      this.scheduleAdmissionRetry();
      await this.deps.armAlarm();
      return true;
    }
  }

  public async authorizeCallback(
    input: AgentRunWorkflowCallbackInput,
  ): Promise<"current" | "deleted" | "terminal"> {
    if ((await agentRunWorkflowInputHash(input.input)) !== input.inputHash) {
      throw ownershipConflict("AgentRun Workflow input hash mismatch.");
    }
    const expectedId = agentRunWorkflowInstanceId(input.input.runId);
    if (input.workflowInstanceId !== expectedId) {
      throw ownershipConflict("AgentRun Workflow callback identity mismatch.");
    }
    this.assertStoredIdentity(input.inputHash, expectedId);
    if (isAgentRunDeleted(this.deps.ctx)) return "deleted";
    if (!hasActiveRun(this.deps.getStatus())) return "terminal";
    this.promoteAdmission(input.inputHash, expectedId);
    return "current";
  }

  public async failWorkflow(input: AgentRunWorkflowFailureInput): Promise<Response> {
    if (isAgentRunDeleted(this.deps.ctx) || !hasActiveRun(this.deps.getStatus())) {
      return Response.json({ ok: true });
    }
    this.assertStoredIdentity(input.inputHash, input.workflowInstanceId);
    await this.deps.finalizeWorkflowFailure(input);
    return Response.json({ ok: true });
  }

  public async terminate(): Promise<void> {
    const workflowId = getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ID_KEY);
    if (!workflowId) return;
    const instance = await this.deps.env.AGENT_RUN_WORKFLOW.get(workflowId);
    const { status } = await instance.status();
    if (
      status === "queued" ||
      status === "running" ||
      status === "waiting" ||
      status === "waitingForPause" ||
      status === "paused"
    ) {
      await instance.terminate();
    }
  }

  private writePendingAdmission(payload: AgentRunWorkflowPayload): void {
    const workflowId = agentRunWorkflowInstanceId(payload.input.runId);
    deleteRunStateValues(this.deps.ctx, [AGENT_RUN_WORKFLOW_ADMITTED_KEY]);
    setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ID_KEY, workflowId);
    setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_INPUT_HASH_KEY, payload.inputHash);
    setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_PENDING_INPUT_KEY, JSON.stringify(payload));
    setRunStateValue(
      this.deps.ctx,
      AGENT_RUN_WORKFLOW_RETRY_AT_KEY,
      String(Date.now() + AGENT_RUN_WORKFLOW_RETRY_BASE_MS),
    );
    setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_RETRY_ATTEMPT_KEY, "0");
  }

  private assertPendingAdmission(payload: AgentRunWorkflowPayload): void {
    this.assertStoredIdentity(payload.inputHash, agentRunWorkflowInstanceId(payload.input.runId));
    const pending = this.pendingPayload();
    if (pending.inputHash !== payload.inputHash) {
      throw ownershipConflict("AgentRun Workflow pending admission identity mismatch.");
    }
  }

  private assertStoredIdentity(inputHash: string, workflowInstanceId: string): void {
    if (
      getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ID_KEY) !== workflowInstanceId ||
      getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_INPUT_HASH_KEY) !== inputHash
    ) {
      throw ownershipConflict("AgentRun Workflow ownership identity mismatch.");
    }
  }

  private promoteAdmission(inputHash: string, workflowInstanceId: string): void {
    this.deps.ctx.storage.transactionSync(() => {
      this.assertStoredIdentity(inputHash, workflowInstanceId);
      setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY, "true");
      setRunStateValue(
        this.deps.ctx,
        AGENT_RUN_WORKFLOW_RECONCILE_AT_KEY,
        String(Date.now() + AGENT_RUN_WORKFLOW_RECONCILE_INTERVAL_MS),
      );
      deleteRunStateValues(this.deps.ctx, [
        AGENT_RUN_WORKFLOW_PENDING_INPUT_KEY,
        AGENT_RUN_WORKFLOW_RETRY_ATTEMPT_KEY,
        AGENT_RUN_WORKFLOW_RETRY_AT_KEY,
        AGENT_RUN_WORKFLOW_UNKNOWN_ATTEMPT_KEY,
      ]);
    });
  }

  private pendingPayload(): AgentRunWorkflowPayload {
    const raw = getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_PENDING_INPUT_KEY);
    const parsed = AgentRunWorkflowPayloadSchema.safeParse(safeJson(raw));
    if (!parsed.success) {
      throw ownershipUnavailable("AgentRun Workflow admission state is incomplete.");
    }
    return parsed.data;
  }

  private async admitPendingPayload(payload: AgentRunWorkflowPayload): Promise<void> {
    const expectedId = agentRunWorkflowInstanceId(payload.input.runId);
    this.assertStoredIdentity(payload.inputHash, expectedId);
    const admittedId = await admitAgentRunWorkflow(this.deps.env, payload);
    if (admittedId !== expectedId) {
      throw ownershipConflict("AgentRun Workflow admitted an unexpected instance id.");
    }
    if (!isAgentRunDeleted(this.deps.ctx) && hasActiveRun(this.deps.getStatus())) {
      this.promoteAdmission(payload.inputHash, admittedId);
      await this.deps.armAlarm();
    }
  }

  private async recordAdmissionFailure(): Promise<void> {
    if (isAgentRunDeleted(this.deps.ctx) || !hasActiveRun(this.deps.getStatus())) return;
    this.scheduleAdmissionRetry();
    await this.deps.armAlarm();
  }

  private scheduleAdmissionRetry(): void {
    this.deps.ctx.storage.transactionSync(() => {
      const rawAttempt = Number(
        getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_RETRY_ATTEMPT_KEY) ?? "0",
      );
      const attempt = Number.isSafeInteger(rawAttempt) && rawAttempt >= 0 ? rawAttempt : 0;
      const delay = Math.min(
        AGENT_RUN_WORKFLOW_RETRY_BASE_MS * 2 ** Math.min(attempt, 10),
        AGENT_RUN_WORKFLOW_RETRY_MAX_MS,
      );
      setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_RETRY_ATTEMPT_KEY, String(attempt + 1));
      setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_RETRY_AT_KEY, String(Date.now() + delay));
    });
  }

  private async reconcileAdmittedWorkflow(): Promise<void> {
    const now = Date.now();
    const reconcileAt = getRunStateTimestamp(this.deps.ctx, AGENT_RUN_WORKFLOW_RECONCILE_AT_KEY);
    if (reconcileAt !== null && reconcileAt > now) return;

    const workflowId = getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_ID_KEY);
    if (!workflowId) {
      await this.failInterruptedWorkflow("AgentRun Workflow identity is missing.");
      return;
    }

    const workflowStatus = await this.fetchWorkflowStatus(workflowId);
    if (!workflowStatus) return;
    if (isActiveWorkflowStatus(workflowStatus.status)) {
      deleteRunStateValues(this.deps.ctx, [AGENT_RUN_WORKFLOW_UNKNOWN_ATTEMPT_KEY]);
      await this.scheduleWorkflowReconciliation();
      return;
    }

    if (workflowStatus.status === "unknown") {
      const attempt = this.incrementUnknownWorkflowAttempt();
      if (attempt < AGENT_RUN_WORKFLOW_UNKNOWN_ATTEMPT_LIMIT) {
        await this.scheduleWorkflowReconciliation();
        return;
      }
    }

    const runId = getRunStateValue(this.deps.ctx, "run_id");
    createLogger(runId ? { runId } : {}).error("agent_run_workflow_terminal_mismatch", {
      error: workflowStatus.error,
      workflowId,
      workflowStatus: workflowStatus.status,
    });
    await this.failInterruptedWorkflow(
      workflowStatus.status === "complete"
        ? "Agent run completion was not committed."
        : "Agent run execution stopped before completion.",
    );
  }

  private async fetchWorkflowStatus(
    workflowId: string,
  ): Promise<Awaited<ReturnType<WorkflowInstance["status"]>> | null> {
    try {
      return await (await this.deps.env.AGENT_RUN_WORKFLOW.get(workflowId)).status();
    } catch (error) {
      const runId = getRunStateValue(this.deps.ctx, "run_id");
      createLogger(runId ? { runId } : {}).warn("agent_run_workflow_status_unavailable", {
        error,
        workflowId,
      });
      await this.scheduleWorkflowReconciliation();
      return null;
    }
  }

  private incrementUnknownWorkflowAttempt(): number {
    return this.deps.ctx.storage.transactionSync(() => {
      const rawAttempt = Number(
        getRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_UNKNOWN_ATTEMPT_KEY) ?? "0",
      );
      const attempt = Number.isSafeInteger(rawAttempt) && rawAttempt >= 0 ? rawAttempt + 1 : 1;
      setRunStateValue(this.deps.ctx, AGENT_RUN_WORKFLOW_UNKNOWN_ATTEMPT_KEY, String(attempt));
      return attempt;
    });
  }

  private async scheduleWorkflowReconciliation(): Promise<void> {
    setRunStateValue(
      this.deps.ctx,
      AGENT_RUN_WORKFLOW_RECONCILE_AT_KEY,
      String(Date.now() + AGENT_RUN_WORKFLOW_RECONCILE_INTERVAL_MS),
    );
    await this.deps.armAlarm();
  }

  private async failInterruptedWorkflow(message: string): Promise<void> {
    await this.deps.finalizeWorkflowFailure({
      code: "run_interrupted",
      message,
      retriable: true,
    });
  }
}

function isActiveWorkflowStatus(status: AgentRunWorkflowStatus): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "waiting" ||
    status === "waitingForPause" ||
    status === "paused"
  );
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
  return new APIError(503, "service_maintenance_unavailable", message, {
    hint: "Retry the same run admission request.",
    retriable: true,
  });
}
