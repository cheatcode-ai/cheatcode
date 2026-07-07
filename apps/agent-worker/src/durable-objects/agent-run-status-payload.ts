import { pendingApprovalSnapshot } from "./agent-run-approvals";
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
  const pending = pendingApprovalSnapshot(input.ctx);
  const pendingApproval = pending ? { pendingApproval: pending } : {};
  const stored = readStoredRunSnapshot(input.ctx);
  if (stored) {
    return { ...stored, ...pendingApproval, ok: true, status: input.status, summary };
  }
  return {
    budget: { capUsd: 0, tokensIn: 0, tokensOut: 0, usdSpent: 0 },
    completedAt: getRunStateTimestamp(input.ctx, "completed_at"),
    createdAt: Date.now(),
    lastSeq: 0,
    messageCount: 0,
    modelId: "unknown",
    ok: true,
    ...pendingApproval,
    runId: input.runId,
    startedAt: null,
    status: input.status,
    summary,
  };
}

function statusSummary(input: StatusPayloadInput): string {
  const summary = summarizeAgentRunRows(input.replayRows, input.status);
  // While running, the transcript summary is the model's own words. Before any
  // model text arrives it is empty, so fall back to the internal run stage (and a
  // neutral default) rather than showing a blank status line.
  if (input.status === "running" && summary.trim().length === 0) {
    return getRunStateValue(input.ctx, "run_stage") ?? "Working…";
  }
  return summary;
}
