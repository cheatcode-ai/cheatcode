import { getRunStateTimestamp, getRunStateValue, readStoredRunSnapshot } from "./agent-run-storage";
import { type AgentRunSnapshotStatus, summarizeAgentRunRows } from "./run-summary";

interface StatusPayloadInput {
  ctx: DurableObjectState;
  replayRows: unknown[];
  runId: string;
  status: AgentRunSnapshotStatus;
}

export function agentRunStatusPayload(input: StatusPayloadInput): unknown {
  const summary = statusSummary(input);
  const stored = readStoredRunSnapshot(input.ctx);
  if (stored) {
    return { ...stored, ok: true, status: input.status, summary };
  }
  return {
    budget: { capUsd: 0, tokensIn: 0, tokensOut: 0, usdSpent: 0 },
    completedAt: getRunStateTimestamp(input.ctx, "completed_at"),
    createdAt: Date.now(),
    lastSeq: 0,
    messageCount: 0,
    modelId: "unknown",
    ok: true,
    runId: input.runId,
    startedAt: null,
    status: input.status,
    summary,
  };
}

function statusSummary(input: StatusPayloadInput): string {
  const summary = summarizeAgentRunRows(input.replayRows, input.status);
  if (input.status === "running" && summary === "Running code in the project sandbox...") {
    return getRunStateValue(input.ctx, "run_stage") ?? summary;
  }
  return summary;
}
