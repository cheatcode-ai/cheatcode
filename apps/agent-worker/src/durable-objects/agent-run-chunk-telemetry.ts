import { emitUserEvent } from "@cheatcode/observability";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";
import { getRunStateValue, setRunStateValue } from "./agent-run-storage";

const STEP_IDX_KEY = "telemetry_step_idx";

interface ToolStartState {
  stepIdx: number;
  startedAt: number;
  toolName: string;
}

export function emitMastraChunkTelemetry(
  ctx: DurableObjectState,
  env: AgentRunEnv,
  input: StartRunInput,
  chunk: unknown,
): void {
  const record = asRecord(chunk);
  const type = stringField(record, "type");
  if (type === "tool-call") {
    emitToolStarted(ctx, env, input, record);
    return;
  }
  if (type === "tool-result") {
    emitToolCompleted(ctx, env, input, record);
  }
}

function emitToolStarted(
  ctx: DurableObjectState,
  env: AgentRunEnv,
  input: StartRunInput,
  record: Record<string, unknown>,
): void {
  const payload = chunkPayload(record);
  const toolName = toolNameFromPayload(payload);
  if (!toolName) {
    return;
  }
  const stepIdx = nextStepIdx(ctx);
  setRunStateValue(
    ctx,
    toolStateKey(payload, toolName),
    JSON.stringify({ stepIdx, startedAt: Date.now(), toolName }),
  );
  emitUserEvent(env, {
    eventName: "step_started",
    runId: input.runId,
    stepIdx,
    stepType: "tool",
    toolName,
    userId: input.userId,
  });
}

function emitToolCompleted(
  ctx: DurableObjectState,
  env: AgentRunEnv,
  input: StartRunInput,
  record: Record<string, unknown>,
): void {
  const payload = chunkPayload(record);
  const toolName = toolNameFromPayload(payload);
  if (!toolName) {
    return;
  }
  const state = readToolStartState(ctx, payload, toolName) ?? {
    startedAt: Date.now(),
    stepIdx: nextStepIdx(ctx),
    toolName,
  };
  const durationMs = Math.max(0, Date.now() - state.startedAt);
  const resultBytes = serializedResultBytes(payload);
  emitUserEvent(env, {
    durationMs,
    eventName: "tool_invoked",
    resultBytes,
    runId: input.runId,
    stepIdx: state.stepIdx,
    toolName,
    userId: input.userId,
  });
  emitUserEvent(env, {
    durationMs,
    eventName: "step_completed",
    resultBytes,
    runId: input.runId,
    stepIdx: state.stepIdx,
    stepType: "tool",
    toolName,
    userId: input.userId,
  });
  if (toolName === "skill_invoke") {
    emitSkillInvoked(env, input, payload, durationMs);
  }
}

function emitSkillInvoked(
  env: AgentRunEnv,
  input: StartRunInput,
  payload: Record<string, unknown>,
  durationMs: number,
): void {
  const skillName =
    stringField(asRecord(payload["input"]), "skillName") ||
    stringField(asRecord(payload["args"]), "skillName") ||
    stringField(asRecord(payload["output"]), "name") ||
    stringField(asRecord(payload["result"]), "name");
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

function readToolStartState(
  ctx: DurableObjectState,
  payload: Record<string, unknown>,
  toolName: string,
): ToolStartState | null {
  const raw = getRunStateValue(ctx, toolStateKey(payload, toolName));
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

function toolStateKey(payload: Record<string, unknown>, toolName: string): string {
  const id = stringField(payload, "toolCallId") || stringField(payload, "id") || toolName;
  return `telemetry_tool:${id}`;
}

function isToolStartState(value: unknown): value is ToolStartState {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["toolName"] === "string" &&
    typeof (value as Record<string, unknown>)["stepIdx"] === "number" &&
    typeof (value as Record<string, unknown>)["startedAt"] === "number"
  );
}

function chunkPayload(record: Record<string, unknown>): Record<string, unknown> {
  const payload = asRecord(record["payload"]);
  return Object.keys(payload).length > 0 ? payload : record;
}

function toolNameFromPayload(payload: Record<string, unknown>): string {
  return stringField(payload, "toolName") || stringField(payload, "tool");
}

function serializedResultBytes(payload: Record<string, unknown>): number {
  const result = payload["output"] ?? payload["result"] ?? payload;
  return new TextEncoder().encode(JSON.stringify(result)).byteLength;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
