const DAY_MS = 86_400_000;

export const QUOTA_TRACKER_RETENTION_MS = 366 * DAY_MS;

export function nextQuotaTrackerAlarm(nowMs: number): number {
  return nowMs + DAY_MS;
}
