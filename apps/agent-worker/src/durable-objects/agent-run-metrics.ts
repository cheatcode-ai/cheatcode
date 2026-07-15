import { type AgentMetric, emitAgentMetric, emitUserEvent } from "@cheatcode/observability";
import type { LogicalModelId } from "@cheatcode/types";
import type { AgentRunEnv } from "./agent-run-env";
import type { PersistableRunStatus } from "./agent-run-status-persistence";
import {
  getResolvedRunLogicalModelId,
  getRunStateValue,
  readStoredRunSnapshot,
  type StoredRunSnapshot,
} from "./agent-run-storage";

interface AgentRunMetricInput {
  error?: { type: string };
  runId: string;
  status: PersistableRunStatus;
  userId: string;
}

type RunModelAttribution =
  | { logicalModelId: LogicalModelId; plannedModelId?: never }
  | { logicalModelId?: never; plannedModelId: LogicalModelId | "unknown" };

export function emitStoredAgentRunMetric(
  ctx: DurableObjectState,
  env: AgentRunEnv,
  input: AgentRunMetricInput,
): void {
  if (input.status === "running" || input.status === "paused") {
    return;
  }
  const now = Date.now();
  const snapshot = readStoredRunSnapshot(ctx);
  const modelAttribution = runModelAttribution(snapshot, getResolvedRunLogicalModelId(ctx));
  emitUserEvent(env, runCompletedEvent(input, snapshot, modelAttribution, now));
  emitAgentMetric(env, agentMetricFromRunSnapshot(input, snapshot, modelAttribution, now));
  if (input.status === "completed" && getRunStateValue(ctx, "is_first_run") === "true") {
    emitUserEvent(env, firstRunCompletedEvent(input, snapshot, modelAttribution, now));
  }
}

function agentMetricFromRunSnapshot(
  input: AgentRunMetricInput,
  snapshot: StoredRunSnapshot | null,
  modelAttribution: RunModelAttribution,
  now: number,
): AgentMetric {
  const startedAt = snapshot?.startedAt ?? snapshot?.createdAt ?? now;
  const completedAt = snapshot?.completedAt ?? now;
  const errorCode = input.error?.type ?? defaultErrorCode(input.status);
  return {
    agentName: "general",
    durationMs: Math.max(0, completedAt - startedAt),
    ...(errorCode ? { errorCode } : {}),
    ...modelAttribution,
    runId: input.runId,
    status: input.status === "completed" ? "success" : "error",
    stepType: "run",
    userId: input.userId,
    workerName: "agent",
  };
}

function defaultErrorCode(status: PersistableRunStatus): string | undefined {
  if (status === "failed") {
    return "internal_error";
  }
  if (status === "canceled") {
    return "run_canceled";
  }
  return undefined;
}

function firstRunCompletedEvent(
  input: AgentRunMetricInput,
  snapshot: StoredRunSnapshot | null,
  modelAttribution: RunModelAttribution,
  now: number,
) {
  const startedAt = snapshot?.startedAt ?? snapshot?.createdAt ?? now;
  return {
    durationMs: Math.max(0, (snapshot?.completedAt ?? now) - startedAt),
    eventName: "first_run_completed",
    ...modelAttribution,
    runId: input.runId,
    userId: input.userId,
  };
}

function runCompletedEvent(
  input: AgentRunMetricInput,
  snapshot: StoredRunSnapshot | null,
  modelAttribution: RunModelAttribution,
  now: number,
) {
  const startedAt = snapshot?.startedAt ?? snapshot?.createdAt ?? now;
  const errorCode = input.error?.type ?? defaultErrorCode(input.status);
  return {
    durationMs: Math.max(0, (snapshot?.completedAt ?? now) - startedAt),
    eventName: "run_completed",
    ...(errorCode ? { errorCode } : {}),
    ...modelAttribution,
    runId: input.runId,
    runStatus: input.status,
    userId: input.userId,
  };
}

function runModelAttribution(
  snapshot: StoredRunSnapshot | null,
  resolvedLogicalModelId: LogicalModelId | undefined,
): RunModelAttribution {
  return resolvedLogicalModelId
    ? { logicalModelId: resolvedLogicalModelId }
    : { plannedModelId: snapshot?.modelId ?? "unknown" };
}
