/** Clips a timeout to an optional absolute deadline and refuses expired work. */
export function timeoutBeforeDeadline(
  maximumMs: number,
  deadline: number | undefined,
  label: string,
): number {
  if (deadline === undefined) return maximumMs;
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`${label} exceeded its absolute deadline.`);
  return Math.min(maximumMs, remaining);
}
