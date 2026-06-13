export const AGENT_RUN_RETENTION_DAYS = 30;
export const AGENT_RUN_HARD_DELETE_DAYS = 90;
export const AGENT_RUN_ALARM_INTERVAL_MS = 86_400_000;

export type AgentRunRetentionAction = "clear-messages" | "delete-all" | "reschedule";

export function nextAgentRunAlarm(now: number): number {
  return now + AGENT_RUN_ALARM_INTERVAL_MS;
}

export function resolveAgentRunRetentionAction({
  completedAt,
  now,
}: {
  completedAt: number | null;
  now: number;
}): AgentRunRetentionAction {
  if (completedAt === null) {
    return "reschedule";
  }

  const ageMs = now - completedAt;
  if (ageMs >= AGENT_RUN_HARD_DELETE_DAYS * AGENT_RUN_ALARM_INTERVAL_MS) {
    return "delete-all";
  }
  if (ageMs >= AGENT_RUN_RETENTION_DAYS * AGENT_RUN_ALARM_INTERVAL_MS) {
    return "clear-messages";
  }
  return "reschedule";
}
