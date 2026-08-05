import { pendingAssistantMessageRetryAt } from "./agent-run-message-persistence";
import { nextAgentRunAlarm } from "./agent-run-retention";
import { pendingStatusRetryAt } from "./agent-run-status-persistence";
import { getRunStateTimestamp, getRunStateValue } from "./agent-run-storage";
import {
  AGENT_RUN_WORKFLOW_ADMITTED_KEY,
  AGENT_RUN_WORKFLOW_RECONCILE_AT_KEY,
  AGENT_RUN_WORKFLOW_RETRY_AT_KEY,
} from "./agent-run-workflow-protocol";
import { hasActiveRun } from "./run-state";

/** Re-arms the Durable Object alarm to the earliest outstanding run obligation. */
export async function armAgentRunAlarm(ctx: DurableObjectState): Promise<void> {
  if (!getRunStateValue(ctx, "run_id")) {
    await ctx.storage.deleteAlarm();
    return;
  }
  const isRunActive = hasActiveRun(getRunStateValue(ctx, "status"));
  const admissionRetryAlarm =
    isRunActive && getRunStateValue(ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) !== "true"
      ? (getRunStateTimestamp(ctx, AGENT_RUN_WORKFLOW_RETRY_AT_KEY) ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY;
  const workflowReconcileAlarm =
    isRunActive && getRunStateValue(ctx, AGENT_RUN_WORKFLOW_ADMITTED_KEY) === "true"
      ? (getRunStateTimestamp(ctx, AGENT_RUN_WORKFLOW_RECONCILE_AT_KEY) ?? Date.now())
      : Number.POSITIVE_INFINITY;
  const assistantMessageRetryAlarm = pendingAssistantMessageRetryAt(ctx);
  const statusRetryAlarm =
    assistantMessageRetryAlarm === Number.POSITIVE_INFINITY
      ? pendingStatusRetryAt(ctx)
      : Number.POSITIVE_INFINITY;
  await ctx.storage.setAlarm(
    Math.min(
      admissionRetryAlarm,
      workflowReconcileAlarm,
      assistantMessageRetryAlarm,
      statusRetryAlarm,
      nextAgentRunAlarm(Date.now()),
    ),
  );
}
