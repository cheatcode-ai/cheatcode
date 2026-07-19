import type { AgentChunkType } from "@cheatcode/agent-core";
import { emitUserEvent } from "@cheatcode/observability";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";
import { deleteRunStateValues, getRunStateValue, setRunStateValue } from "./agent-run-storage";

const STEP_IDX_KEY = "telemetry_step_idx";

interface ToolStartState {
  stepIdx: number;
  startedAt: number;
}

type ToolCallPayload = Extract<AgentChunkType, { type: "tool-call" }>["payload"];
type ToolResultPayload = Extract<AgentChunkType, { type: "tool-result" }>["payload"];
type ToolErrorPayload = Extract<AgentChunkType, { type: "tool-error" }>["payload"];

export function emitMastraChunkTelemetry(
  ctx: DurableObjectState,
  env: AgentRunEnv,
  input: StartRunInput,
  chunk: AgentChunkType,
): void {
  if (chunk.type === "tool-call") {
    emitToolStarted(ctx, env, input, chunk.payload);
    return;
  }
  if (chunk.type === "tool-result") {
    const durationMs = emitToolCompleted(
      ctx,
      env,
      input,
      chunk.payload,
      serializedResultBytes(chunk.payload.result),
    );
    if (chunk.payload.toolName === "skill_invoke") {
      emitSkillInvoked(env, input, chunk.payload, durationMs);
    }
    return;
  }
  if (chunk.type === "tool-error") {
    emitToolCompleted(ctx, env, input, chunk.payload, serializedResultBytes(chunk.payload.error));
  }
}

function emitToolStarted(
  ctx: DurableObjectState,
  env: AgentRunEnv,
  input: StartRunInput,
  payload: ToolCallPayload,
): void {
  const stepIdx = nextStepIdx(ctx);
  setRunStateValue(
    ctx,
    toolStateKey(payload.toolCallId),
    JSON.stringify({ stepIdx, startedAt: Date.now() }),
  );
  emitUserEvent(env, {
    eventName: "step_started",
    runId: input.runId,
    stepIdx,
    stepType: "tool",
    toolName: payload.toolName,
    userId: input.userId,
  });
}

function emitToolCompleted(
  ctx: DurableObjectState,
  env: AgentRunEnv,
  input: StartRunInput,
  payload: ToolResultPayload | ToolErrorPayload,
  resultBytes: number,
): number {
  const key = toolStateKey(payload.toolCallId);
  const state = readToolStartState(ctx, payload.toolCallId) ?? {
    startedAt: Date.now(),
    stepIdx: nextStepIdx(ctx),
  };
  deleteRunStateValues(ctx, [key]);
  const durationMs = Math.max(0, Date.now() - state.startedAt);
  emitUserEvent(env, {
    durationMs,
    eventName: "tool_invoked",
    resultBytes,
    runId: input.runId,
    stepIdx: state.stepIdx,
    toolName: payload.toolName,
    userId: input.userId,
  });
  emitUserEvent(env, {
    durationMs,
    eventName: "step_completed",
    resultBytes,
    runId: input.runId,
    stepIdx: state.stepIdx,
    stepType: "tool",
    toolName: payload.toolName,
    userId: input.userId,
  });
  return durationMs;
}

function emitSkillInvoked(
  env: AgentRunEnv,
  input: StartRunInput,
  payload: ToolResultPayload,
  durationMs: number,
): void {
  const skillName =
    stringField(asRecord(payload.args), "skillName") ||
    stringField(asRecord(payload.result), "name");
  emitUserEvent(env, {
    durationMs,
    eventName: "skill_invoked",
    ...(skillName ? { skillName } : {}),
    runId: input.runId,
    userId: input.userId,
  });
}

function nextStepIdx(ctx: DurableObjectState): number {
  const current = Number.parseInt(getRunStateValue(ctx, STEP_IDX_KEY) ?? "0", 10);
  const next = Number.isFinite(current) ? current + 1 : 1;
  setRunStateValue(ctx, STEP_IDX_KEY, String(next));
  return next;
}

function readToolStartState(ctx: DurableObjectState, toolCallId: string): ToolStartState | null {
  const raw = getRunStateValue(ctx, toolStateKey(toolCallId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isToolStartState(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function toolStateKey(toolCallId: string): string {
  return `telemetry_tool:${toolCallId}`;
}

function isToolStartState(value: unknown): value is ToolStartState {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["stepIdx"] === "number" &&
    typeof (value as Record<string, unknown>)["startedAt"] === "number"
  );
}

function serializedResultBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 0 : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return 0;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
