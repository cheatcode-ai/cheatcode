/** Single authority for lifecycle retry/quarantine policy, enforced by the db defer lease transactions and claim SQL primitives. */

const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 30_000;

export const MAX_TRANSIENT_DELETION_FAILURES = 8;

export const DELETION_JOB_DEFER_POLICY = {
  deferredStatus: (failureCount: number): "queued" | "quarantined" =>
    failureCount >= MAX_TRANSIENT_DELETION_FAILURES ? "quarantined" : "queued",
  retryDelayMs,
};

export const DAILY_MAINTENANCE_DEFER_POLICY = {
  deferredStatus: (): "queued" => "queued",
  normalizeErrorCode: (errorCode: string): string => errorCode.slice(0, 128),
  retryDelayMs,
};

function retryDelayMs(failureCount: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** Math.min(failureCount - 1, 10));
}
