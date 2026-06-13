import { emitUserEvent } from "@cheatcode/observability";
import type { AgentRunEnv } from "./agent-run-env";
import { getRunStateValue } from "./agent-run-storage";

export function emitRunAbandoned(ctx: DurableObjectState, env: AgentRunEnv): void {
  if (getRunStateValue(ctx, "status") !== "running") {
    return;
  }
  const runId = getRunStateValue(ctx, "run_id");
  const userId = getRunStateValue(ctx, "owner_user_id");
  if (!runId || !userId) {
    return;
  }
  emitUserEvent(env, {
    eventName: "run_abandoned",
    runId,
    userId,
  });
}
