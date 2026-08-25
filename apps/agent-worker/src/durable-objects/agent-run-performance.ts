import {
  type AnalyticsBindings,
  emitPerformanceMetric,
  type PerformanceMetric,
} from "@cheatcode/observability";
import type { UIMessageChunk } from "ai";
import { getRunStateValue, readStoredRunSnapshot, setRunStateValue } from "./agent-run-storage";

const METRIC_KEYS = {
  finalToken: "final_token_metric_emitted",
  firstModelText: "first_model_text_metric_emitted",
  firstStatus: "first_status_metric_emitted",
  runCompletion: "run_completion_metric_emitted",
} as const;

interface RunPerformanceEnv extends AnalyticsBindings {
  CF_VERSION_METADATA?: { id: string };
  CHEATCODE_ENVIRONMENT?: string;
  CHEATCODE_RELEASE_SHA?: string;
}

export function emitRunChunkPerformanceMetrics(
  ctx: DurableObjectState,
  env: RunPerformanceEnv,
  chunk: UIMessageChunk,
  now = Date.now,
): void {
  if (isFirstStatusChunk(chunk)) emitOnce(ctx, env, "firstStatus", now);
  if (isFirstModelTextChunk(chunk)) emitOnce(ctx, env, "firstModelText", now);
  if (chunk.type === "text-end") emitOnce(ctx, env, "finalToken", now);
  if (chunk.type === "finish") emitOnce(ctx, env, "runCompletion", now);
}

export function emitWorkflowAcceptanceMetric(
  ctx: DurableObjectState,
  env: RunPerformanceEnv,
  durationMs: number,
): void {
  const key = "workflow_acceptance_metric_emitted";
  if (getRunStateValue(ctx, key) === "true") return;
  const snapshot = readStoredRunSnapshot(ctx);
  emitPerformanceMetric(env, {
    ...runDimensions(env),
    ...(snapshot ? { logicalModelId: snapshot.modelId } : {}),
    ...(snapshot ? { provider: modelProvider(snapshot.modelId) } : {}),
    route: "/internal/runs/start",
    statusClass: "accepted",
    workerName: "agent",
    workflowAcceptanceMs: Math.max(0, durationMs),
  });
  setRunStateValue(ctx, key, "true");
}

function emitOnce(
  ctx: DurableObjectState,
  env: RunPerformanceEnv,
  phase: keyof typeof METRIC_KEYS,
  now: () => number,
): void {
  const key = METRIC_KEYS[phase];
  if (getRunStateValue(ctx, key) === "true") return;
  const snapshot = readStoredRunSnapshot(ctx);
  const durationMs = Math.max(0, now() - (snapshot?.startedAt ?? now()));
  emitPerformanceMetric(env, {
    ...runDimensions(env),
    ...(phase === "finalToken" ? { finalTokenMs: durationMs } : {}),
    ...(phase === "firstModelText" ? { firstModelTextMs: durationMs, ttftMs: durationMs } : {}),
    ...(phase === "firstStatus" ? { firstStatusMs: durationMs } : {}),
    ...(phase === "runCompletion" ? { runCompletionMs: durationMs } : {}),
    ...(snapshot ? { logicalModelId: snapshot.modelId } : {}),
    ...(snapshot ? { provider: modelProvider(snapshot.modelId) } : {}),
    route: "/internal/runs/start",
    statusClass: "streaming",
    workerName: "agent",
  });
  setRunStateValue(ctx, key, "true");
}

function runDimensions(env: RunPerformanceEnv): Pick<PerformanceMetric, "envTag" | "versionTag"> {
  const versionTag = env.CF_VERSION_METADATA?.id ?? env.CHEATCODE_RELEASE_SHA;
  return {
    ...(env.CHEATCODE_ENVIRONMENT ? { envTag: env.CHEATCODE_ENVIRONMENT } : {}),
    ...(versionTag ? { versionTag } : {}),
  };
}

function modelProvider(modelId: string): string {
  return modelId.slice(0, modelId.indexOf("/"));
}

function isFirstStatusChunk(chunk: UIMessageChunk): boolean {
  return chunk.type === "data-sandbox-status" || chunk.type === "data-error";
}

function isFirstModelTextChunk(chunk: UIMessageChunk): boolean {
  if (chunk.type === "text-delta") return chunk.delta.trim().length > 0;
  if (chunk.type !== "data-model-provisional") return false;
  const data = (Object(chunk) as Record<string, unknown>)["data"];
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return record["phase"] === "delta" && String(record["delta"] ?? "").trim().length > 0;
}
