const DAY_MS = 86_400_000;

export const RATE_LIMITER_RETENTION_MS = DAY_MS;
export const QUOTA_TRACKER_RETENTION_MS = 366 * DAY_MS;

export function nextGatewayDurableObjectAlarm(nowMs: number): number {
  return nowMs + DAY_MS;
}
