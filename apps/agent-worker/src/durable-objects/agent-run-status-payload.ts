import { getRunStateValue, readStoredRunSnapshot } from "./agent-run-storage";
import { type AgentRunSnapshotStatus, summarizeAgentRunStorage } from "./run-summary";

interface StatusPayloadInput {
  ctx: DurableObjectState;
  status: AgentRunSnapshotStatus;
}

export function agentRunStatusPayload(input: StatusPayloadInput): unknown | null {
  const summary = statusSummary(input);
  const stored = readStoredRunSnapshot(input.ctx);
  if (!stored) {
    return null;
  }
  return { ...stored, ok: true, status: input.status, summary };
}

function statusSummary(input: StatusPayloadInput): string {
  const summary = summarizeAgentRunStorage(input.ctx, input.status);
  // While running, the transcript summary is the model's own words. Before any
  // model text arrives it is empty, so fall back to the internal run stage (and a
  // neutral default) rather than showing a blank status line.
  if (input.status === "running" && summary.trim().length === 0) {
    return getRunStateValue(input.ctx, "run_stage") ?? "Working…";
  }
  return summary;
}
