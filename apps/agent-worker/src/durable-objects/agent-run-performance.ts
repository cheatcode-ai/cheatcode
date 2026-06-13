import { type AnalyticsBindings, emitPerformanceMetric } from "@cheatcode/observability";
import type { UIMessageChunk } from "ai";
import { getRunStateValue, readStoredRunSnapshot, setRunStateValue } from "./agent-run-storage";

const FIRST_VISIBLE_METRIC_KEY = "first_visible_metric_emitted";

export function emitFirstVisibleChunkMetric(
  ctx: DurableObjectState,
  env: AnalyticsBindings,
  chunk: UIMessageChunk,
  now = Date.now,
): void {
  if (getRunStateValue(ctx, FIRST_VISIBLE_METRIC_KEY) === "true" || !isVisibleChunk(chunk)) {
    return;
  }
  const startedAt = readStoredRunSnapshot(ctx)?.startedAt ?? now();
  emitPerformanceMetric(env, {
    route: "/internal/runs/start",
    statusClass: "streaming",
    ttftMs: Math.max(0, now() - startedAt),
    workerName: "agent",
  });
  setRunStateValue(ctx, FIRST_VISIBLE_METRIC_KEY, "true");
}

function isVisibleChunk(chunk: UIMessageChunk): boolean {
  if (chunk.type === "text-delta") {
    return chunk.delta.trim().length > 0;
  }
  return chunk.type === "data-error" || chunk.type === "data-sandbox-status";
}
