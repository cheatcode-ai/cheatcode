const AUDIT_ARCHIVE_JOB_STARTED_AT_ENV = "CHEATCODE_AUDIT_ARCHIVE_JOB_STARTED_AT_MS";
const AUDIT_ARCHIVE_JOB_TIMEOUT_MS = 240 * 60 * 1_000;
const AUDIT_ARCHIVE_SAFETY_MARGIN_MS = 15 * 60 * 1_000;

export function createAuditArchiveOperationDeadline(): number {
  assertProtectedAuditArchiveRuntime();
  const now = Date.now();
  const startedAt = requiredJobStartedAt(now);
  const deadline = startedAt + AUDIT_ARCHIVE_JOB_TIMEOUT_MS - AUDIT_ARCHIVE_SAFETY_MARGIN_MS;
  if (deadline <= now) throw new Error("The protected Audit Archive operation deadline elapsed.");
  return deadline;
}

function assertProtectedAuditArchiveRuntime(): void {
  const repository = process.env["GITHUB_REPOSITORY"]?.trim();
  const expectedWorkflowRef = `${repository}/.github/workflows/audit-archive.yml@refs/heads/main`;
  if (
    process.env["GITHUB_ACTIONS"] !== "true" ||
    process.env["GITHUB_EVENT_NAME"] !== "workflow_dispatch" ||
    process.env["GITHUB_REF"] !== "refs/heads/main" ||
    !repository ||
    process.env["GITHUB_WORKFLOW_REF"] !== expectedWorkflowRef
  ) {
    throw new Error(
      "Production mutation is permitted only in the protected Audit Archive workflow.",
    );
  }
}

function requiredJobStartedAt(now: number): number {
  const rawStartedAt = process.env[AUDIT_ARCHIVE_JOB_STARTED_AT_ENV]?.trim();
  if (!rawStartedAt || !/^\d{13}$/u.test(rawStartedAt)) {
    throw new Error(
      `${AUDIT_ARCHIVE_JOB_STARTED_AT_ENV} is required for audit archive operations.`,
    );
  }
  const startedAt = Number(rawStartedAt);
  if (!Number.isSafeInteger(startedAt) || startedAt > now + 60_000) {
    throw new Error(`${AUDIT_ARCHIVE_JOB_STARTED_AT_ENV} is invalid.`);
  }
  return startedAt;
}
