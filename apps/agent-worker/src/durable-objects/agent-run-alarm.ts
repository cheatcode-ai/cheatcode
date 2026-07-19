import { pendingAssistantMessageRetryAt } from "./agent-run-message-persistence";
import { nextAgentRunAlarm } from "./agent-run-retention";
import { pendingStatusRetryAt } from "./agent-run-status-persistence";
import { getRunStateTimestamp, getRunStateValue } from "./agent-run-storage";
import {
  AGENT_RUN_WORKFLOW_ADMITTED_KEY,
  AGENT_RUN_WORKFLOW_LEASE_EXPIRES_AT_KEY,
  AGENT_RUN_WORKFLOW_RETRY_AT_KEY,
} from "./agent-run-workflow-protocol";
import { hasActiveRun } from "./run-state";

const CLOSED_GATE_ALARM_RECHECK_MS = 60_000;

/** Re-arms the Durable Object alarm to the earliest outstanding run obligation. */
export async function armAgentRunAlarm(ctx: DurableObjectState): Promise<void> {
  if (!getRunStateValue(ctx, "run_id")) {
    await ctx.storage.deleteAlarm();
    return;
  }
  const isRunActive = hasActiveRun(getRunStateValue(ctx, "status"));
  const executionLeaseAlarm = isRunActive
    ? (getRunStateTimestamp(ctx, AGENT_RUN_WORKFLOW_LEASE_EXPIRES_AT_KEY) ??
      Number.POSITIVE_INFINITY)
    : Number.POSITIVE_INFINITY;
  const admissionRetryAlarm =
    isRunActive && getRunStateValue(ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) !== "true"
      ? (getRunStateTimestamp(ctx, AGENT_RUN_WORKFLOW_RETRY_AT_KEY) ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY;
  const assistantMessageRetryAlarm = pendingAssistantMessageRetryAt(ctx);
  const statusRetryAlarm =
    assistantMessageRetryAlarm === Number.POSITIVE_INFINITY
      ? pendingStatusRetryAt(ctx)
      : Number.POSITIVE_INFINITY;
  await ctx.storage.setAlarm(
    Math.min(
      admissionRetryAlarm,
      executionLeaseAlarm,
      assistantMessageRetryAlarm,
      statusRetryAlarm,
      nextAgentRunAlarm(Date.now()),
    ),
  );
}

/** Preserve admitted recovery work without executing it while a release is closed. */
export async function armClosedAgentRunAlarm(
  ctx: DurableObjectState,
  status: string | undefined,
): Promise<void> {
  const hasDeferredDatabaseWrite =
    pendingAssistantMessageRetryAt(ctx) !== Number.POSITIVE_INFINITY ||
    pendingStatusRetryAt(ctx) !== Number.POSITIVE_INFINITY;
  if (hasActiveRun(status) || hasDeferredDatabaseWrite) {
    await ctx.storage.setAlarm(Date.now() + CLOSED_GATE_ALARM_RECHECK_MS);
  }
}
