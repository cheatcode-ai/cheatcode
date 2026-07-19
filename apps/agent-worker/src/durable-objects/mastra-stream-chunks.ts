import type { AgentChunkType } from "@cheatcode/agent-core";
import { type ArtifactKind, ArtifactKindSchema } from "@cheatcode/types/artifacts";
import { TOOL_CAPABILITIES } from "@cheatcode/types/capabilities";
import type { UIMessageChunk } from "ai";

const ANSWER_TEXT_ID = "answer";
const SANDBOX_TOOL_NAMES = capabilityNameSet("usesSandbox");
const ARTIFACT_TOOL_NAMES = capabilityNameSet("producesArtifact");

type ToolCallPayload = Extract<AgentChunkType, { type: "tool-call" }>["payload"];
type ToolResultPayload = Extract<AgentChunkType, { type: "tool-result" }>["payload"];
type ToolErrorPayload = Extract<AgentChunkType, { type: "tool-error" }>["payload"];
type VisibleAgentChunk = Extract<
  AgentChunkType,
  { type: "text-delta" | "tool-call" | "tool-error" | "tool-result" }
>;
type NonVisibleAgentChunk = Exclude<AgentChunkType, VisibleAgentChunk>;
type PrivateOutputAgentChunk = Extract<
  NonVisibleAgentChunk,
  {
    type:
      | "file"
      | "reasoning-delta"
      | "reasoning-end"
      | "reasoning-signature"
      | "reasoning-start"
      | "redacted-reasoning"
      | "source";
  }
>;
type ControlAgentChunk = Exclude<NonVisibleAgentChunk, PrivateOutputAgentChunk>;

export function mastraChunkToUiChunks(chunk: AgentChunkType): UIMessageChunk[] {
  switch (chunk.type) {
    case "text-delta":
      return textDeltaChunks(chunk.payload.text);
    case "tool-call":
      return toolCallChunks(chunk.payload);
    case "tool-result":
      return toolResultChunks(chunk.payload);
    case "tool-error":
      return isSandboxTool(chunk.payload) ? [sandboxStatusChunk("ready")] : [];
    default:
      return nonVisibleMastraChunk(chunk);
  }
}

function nonVisibleMastraChunk(chunk: NonVisibleAgentChunk): UIMessageChunk[] {
  switch (chunk.type) {
    // Reasoning is intentionally private; binary/provider-source output must cross the
    // bounded artifact tools instead of entering the transcript directly.
    case "file":
    case "reasoning-delta":
    case "reasoning-end":
    case "reasoning-signature":
    case "reasoning-start":
    case "redacted-reasoning":
    case "source":
      return [];
    default:
      return controlMastraChunk(chunk);
  }
}

function controlMastraChunk(chunk: ControlAgentChunk): UIMessageChunk[] {
  switch (chunk.type) {
    // These lifecycle/control chunks either have a dedicated Cheatcode channel or carry no
    // user-visible transcript data. Listing them makes a future Mastra union addition fail CI.
    case "abort":
    case "background-task-cancelled":
    case "background-task-completed":
    case "background-task-failed":
    case "background-task-output":
    case "background-task-progress":
    case "background-task-resumed":
    case "background-task-running":
    case "background-task-started":
    case "background-task-suspended":
    case "error":
    case "finish":
    case "goal":
    case "is-task-complete":
    case "object":
    case "object-result":
    case "raw":
    case "response-metadata":
    case "start":
    case "step-finish":
    case "step-output":
    case "step-start":
    case "text-end":
    case "text-start":
    case "tool-call-delta":
    case "tool-call-input-streaming-end":
    case "tool-call-input-streaming-start":
    case "tool-call-suspended":
    case "tool-output":
    case "tripwire":
    case "watch":
      return [];
    default:
      return [];
  }
}

function toolResultChunks(payload: ToolResultPayload): UIMessageChunk[] {
  if (payload.toolName === "skill_create") {
    const skill = skillProposedChunkFromResult(payload.result);
    return skill ? [skill] : [];
  }
  if (isSandboxTool(payload)) {
    const chunks = [sandboxStatusChunk("ready")];
    if (isArtifactTool(payload)) {
      const artifact = artifactChunkFromResult(payload.result);
      if (artifact) {
        chunks.push(artifact);
      }
    }
    return chunks;
  }
  if (isArtifactTool(payload)) {
    const artifact = artifactChunkFromResult(payload.result);
    return artifact ? [artifact] : [];
  }
  return [];
}

function skillProposedChunkFromResult(result: unknown): UIMessageChunk | undefined {
  const record = asRecord(result);
  const name = stringField(record, "name");
  const description = stringField(record, "description");
  const body = stringField(record, "body");
  const category = stringField(record, "category");
  const proposalId = stringField(record, "proposalId");
  const slug = stringField(record, "slug");
  const tags = stringArrayField(record, "tags");
  if (
    record["proposed"] !== true ||
    !name ||
    !description ||
    !body ||
    !category ||
    !proposalId ||
    !slug ||
    !tags
  ) {
    return undefined;
  }
  return {
    type: "data-skill-proposed",
    data: { body, category, description, name, proposalId, slug, tags, v: 1 },
  };
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

export function mastraChunkError(chunk: AgentChunkType): unknown | null {
  if (chunk.type !== "error") {
    return null;
  }
  return chunk.payload.error ?? new Error("Unknown Mastra stream error.");
}

export function normalizeMastraStreamError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  if (typeof error !== "object" || error === null) {
    return new Error("Unknown Mastra stream error.");
  }
  const record = error as Record<string, unknown>;
  const message =
    stringField(record, "message") || stringField(record, "error") || "Mastra stream error.";
  const normalized: Error & { status?: number; statusCode?: number } = new Error(message);
  const status = record["status"];
  const statusCode = record["statusCode"];
  if (typeof status === "number") {
    normalized.status = status;
  }
  if (typeof statusCode === "number") {
    normalized.statusCode = statusCode;
  }
  return normalized;
}

function textDeltaChunks(text: string): UIMessageChunk[] {
  if (text.length === 0) {
    return [];
  }
  return [{ type: "text-delta", id: ANSWER_TEXT_ID, delta: text }];
}

function sandboxStatusChunk(status: "ready" | "starting"): UIMessageChunk {
  return {
    type: "data-sandbox-status",
    data: { v: 1, status },
  };
}

const MAX_TOOL_INPUT_KEYS = 8;
const MAX_TOOL_INPUT_STRING = 256;

// Surface every tool call as a transcript row (Cheatcode parity). Sandbox tools also drive
// the Computer-panel status; non-sandbox tools only get the row.
function toolCallChunks(payload: ToolCallPayload): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [toolActivityChunk(payload)];
  if (SANDBOX_TOOL_NAMES.has(payload.toolName)) {
    chunks.push(sandboxStatusChunk("starting"));
  }
  return chunks;
}

function toolActivityChunk(payload: ToolCallPayload): UIMessageChunk {
  const input = toolInputFromPayload(payload);
  return {
    type: "data-tool",
    data: {
      v: 1,
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
      ...(input ? { input } : {}),
    },
  };
}

// Keep the persisted part small: only scalar args, capped count + string length. The
// transcript row needs the path/command/url/query, not the full (possibly huge) payload.
function toolInputFromPayload(payload: ToolCallPayload): Record<string, unknown> | undefined {
  const input = asRecord(payload.args);
  if (Object.keys(input).length > 0) {
    return truncateToolInput(input);
  }
  return undefined;
}

function truncateToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input).slice(0, MAX_TOOL_INPUT_KEYS)) {
    const coerced = truncateToolValue(value);
    if (coerced !== undefined) {
      output[key] = coerced;
    }
  }
  return output;
}

function truncateToolValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") {
    return clampToolString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  // argv-style string arrays (e.g. shell_exec `command`) read best as the joined command
  // line — that is what the "Ran <command>" transcript row shows (Cheatcode parity). Non-string
  // arrays stay summarized by length.
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((item) => typeof item === "string")
      ? clampToolString(value.join(" "))
      : `[${value.length} item(s)]`;
  }
  return undefined;
}

function clampToolString(value: string): string {
  return value.length > MAX_TOOL_INPUT_STRING ? `${value.slice(0, MAX_TOOL_INPUT_STRING)}…` : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function isSandboxTool(payload: ToolResultPayload | ToolErrorPayload): boolean {
  return SANDBOX_TOOL_NAMES.has(payload.toolName);
}

function isArtifactTool(payload: ToolResultPayload): boolean {
  return ARTIFACT_TOOL_NAMES.has(payload.toolName);
}

function artifactChunkFromResult(result: unknown): UIMessageChunk | undefined {
  const artifact = artifactRecordFromResult(result);
  const outputId = stringField(artifact, "outputId");
  const kind = artifactKind(artifact);
  const mimeType = stringField(artifact, "mimeType");
  const filename = stringField(artifact, "filename");
  const sizeBytes = numberField(artifact, "sizeBytes");
  if (!outputId || !kind || !mimeType || !filename || sizeBytes === undefined) {
    return undefined;
  }
  return {
    type: "data-artifact",
    data: {
      v: 1,
      filename,
      kind,
      mimeType,
      outputId,
      sizeBytes,
    },
  };
}

function artifactRecordFromResult(value: unknown): Record<string, unknown> {
  const result = asRecord(value);
  if (stringField(result, "outputId")) {
    return result;
  }
  const resultArtifact = asRecord(result["artifact"]);
  if (stringField(resultArtifact, "outputId")) {
    return resultArtifact;
  }
  const resultListArtifact = artifactFromResultList(result["results"]);
  if (resultListArtifact) {
    return resultListArtifact;
  }
  return result;
}

function artifactFromResultList(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const item of value.slice(0, 10)) {
    const artifact = asRecord(asRecord(item)["artifact"]);
    if (stringField(artifact, "outputId")) {
      return artifact;
    }
  }
  return undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function artifactKind(record: Record<string, unknown>): ArtifactKind | undefined {
  const parsed = ArtifactKindSchema.safeParse(stringField(record, "kind"));
  return parsed.success ? parsed.data : undefined;
}

function capabilityNameSet(flag: "producesArtifact" | "usesSandbox"): ReadonlySet<string> {
  return new Set(
    TOOL_CAPABILITIES.filter((capability) => capability[flag]).map((capability) => capability.name),
  );
}
