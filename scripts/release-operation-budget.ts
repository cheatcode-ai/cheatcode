const RELEASE_JOB_STARTED_AT_ENV = "CHEATCODE_RELEASE_JOB_STARTED_AT_MS";
const AUDIT_ARCHIVE_JOB_STARTED_AT_ENV = "CHEATCODE_AUDIT_ARCHIVE_JOB_STARTED_AT_MS";
const AUDIT_ARCHIVE_JOB_TIMEOUT_MS = 240 * 60 * 1_000;
const AUDIT_ARCHIVE_SAFETY_MARGIN_MS = 15 * 60 * 1_000;
const GITHUB_JOB_TIMEOUT_MS = 360 * 60 * 1_000;
const GITHUB_JOB_SAFETY_MARGIN_MS = 10 * 60 * 1_000;
const RECOVERY_RESERVE_MS = 50 * 60 * 1_000;
const OPERATION_BUDGET_MS = {
  open: 160 * 60 * 1_000,
  "stage-closed": 230 * 60 * 1_000,
} as const;

export interface ReleaseOperationBudget {
  operationDeadline: number;
  recoveryDeadline: number;
}

export type BudgetedReleasePhase = keyof typeof OPERATION_BUDGET_MS;

export function assertProtectedReleaseRuntime(): void {
  assertProtectedWorkflowRuntime("production-release.yml", "Production Release");
}

function assertProtectedAuditArchiveRuntime(): void {
  assertProtectedWorkflowRuntime("audit-archive.yml", "Audit Archive");
}

function assertProtectedWorkflowRuntime(workflowFile: string, label: string): void {
  const repository = process.env["GITHUB_REPOSITORY"]?.trim();
  const expectedWorkflowRef = `${repository}/.github/workflows/${workflowFile}@refs/heads/main`;
  if (
    process.env["GITHUB_ACTIONS"] !== "true" ||
    process.env["GITHUB_EVENT_NAME"] !== "workflow_dispatch" ||
    process.env["GITHUB_REF"] !== "refs/heads/main" ||
    !repository ||
    process.env["GITHUB_WORKFLOW_REF"] !== expectedWorkflowRef
  ) {
    throw new Error(`Production mutation is permitted only in the protected ${label} workflow.`);
  }
}

export function createAuditArchiveOperationDeadline(): number {
  assertProtectedAuditArchiveRuntime();
  const now = Date.now();
  const startedAt = requiredJobStartedAt(AUDIT_ARCHIVE_JOB_STARTED_AT_ENV, now);
  const deadline = startedAt + AUDIT_ARCHIVE_JOB_TIMEOUT_MS - AUDIT_ARCHIVE_SAFETY_MARGIN_MS;
  if (deadline <= now) throw new Error("The protected Audit Archive operation deadline elapsed.");
  return deadline;
}

/** Reserves a fail-closed recovery window before any writer mutation begins. */
export function createReleaseOperationBudget(phase: BudgetedReleasePhase): ReleaseOperationBudget {
  const now = Date.now();
  const operationBudget = OPERATION_BUDGET_MS[phase];
  const required = operationBudget + RECOVERY_RESERVE_MS;
  const outerDeadline = resolveOuterDeadline(now, required);
  const remaining = outerDeadline - now;
  if (remaining < required) {
    throw new Error(
      `Refusing ${phase}: ${Math.ceil(remaining / 60_000)}m remain, but the bounded operation plus fail-closed recovery require ${Math.ceil(required / 60_000)}m.`,
    );
  }
  const operationDeadline = now + operationBudget;
  return {
    operationDeadline,
    recoveryDeadline: operationDeadline + RECOVERY_RESERVE_MS,
  };
}

function resolveOuterDeadline(now: number, required: number): number {
  if (process.env["GITHUB_ACTIONS"] !== "true") return now + required;
  const startedAt = requiredJobStartedAt(RELEASE_JOB_STARTED_AT_ENV, now);
  return startedAt + GITHUB_JOB_TIMEOUT_MS - GITHUB_JOB_SAFETY_MARGIN_MS;
}

function requiredJobStartedAt(environmentName: string, now: number): number {
  const rawStartedAt = process.env[environmentName]?.trim();
  if (!rawStartedAt || !/^\d{13}$/u.test(rawStartedAt)) {
    throw new Error(`${environmentName} is required for protected production operations.`);
  }
  const startedAt = Number(rawStartedAt);
  if (!Number.isSafeInteger(startedAt) || startedAt > now + 60_000) {
    throw new Error(`${environmentName} is invalid.`);
  }
  return startedAt;
}
