import { type AgentMetric, emitAgentMetric, emitUserEvent } from "@cheatcode/observability";
import type { AgentRunEnv } from "./agent-run-env";
import type { PersistableRunStatus } from "./agent-run-status-persistence";
import {
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
  emitUserEvent(env, runCompletedEvent(input, snapshot, now));
  emitAgentMetric(env, agentMetricFromRunSnapshot(input, snapshot, now));
  if (input.status === "completed" && getRunStateValue(ctx, "is_first_run") === "true") {
    emitUserEvent(env, firstRunCompletedEvent(input, snapshot, now));
  }
}

export function agentMetricFromRunSnapshot(
  input: AgentRunMetricInput,
  snapshot: StoredRunSnapshot | null,
  now: number,
): AgentMetric {
  const startedAt = snapshot?.startedAt ?? snapshot?.createdAt ?? now;
  const completedAt = snapshot?.completedAt ?? now;
  const budget = snapshot?.budget;
  const errorCode = input.error?.type ?? defaultErrorCode(input.status);
  return {
    agentName: "general",
    completionTokens: budget?.tokensOut ?? 0,
    durationMs: Math.max(0, completedAt - startedAt),
    ...(errorCode ? { errorCode } : {}),
    model: snapshot?.modelId ?? "unknown",
    promptTokens: budget?.tokensIn ?? 0,
    runId: input.runId,
    status: input.status === "completed" ? "success" : "error",
    stepType: "run",
    usdCostMicros: Math.round((budget?.usdSpent ?? 0) * 1_000_000),
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
  now: number,
) {
  const startedAt = snapshot?.startedAt ?? snapshot?.createdAt ?? now;
  const budget = snapshot?.budget;
  return {
    durationMs: Math.max(0, (snapshot?.completedAt ?? now) - startedAt),
    eventName: "first_run_completed",
    model: snapshot?.modelId ?? "unknown",
    runId: input.runId,
    tokensUsed: (budget?.tokensIn ?? 0) + (budget?.tokensOut ?? 0),
    userId: input.userId,
  };
}

function runCompletedEvent(
  input: AgentRunMetricInput,
  snapshot: StoredRunSnapshot | null,
  now: number,
) {
  const startedAt = snapshot?.startedAt ?? snapshot?.createdAt ?? now;
  const budget = snapshot?.budget;
  const errorCode = input.error?.type ?? defaultErrorCode(input.status);
  return {
    durationMs: Math.max(0, (snapshot?.completedAt ?? now) - startedAt),
    eventName: "run_completed",
    ...(errorCode ? { errorCode } : {}),
    model: snapshot?.modelId ?? "unknown",
    runId: input.runId,
    runStatus: input.status,
    tokensUsed: (budget?.tokensIn ?? 0) + (budget?.tokensOut ?? 0),
    userId: input.userId,
    valueUsdMicros: Math.round((budget?.usdSpent ?? 0) * 1_000_000),
  };
}
