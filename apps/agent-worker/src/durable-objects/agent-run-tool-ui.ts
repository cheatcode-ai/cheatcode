import { type ArtifactKind, ArtifactKindSchema } from "@cheatcode/types/artifacts";
import { TOOL_CAPABILITIES } from "@cheatcode/types/capabilities";
import type { UIMessageChunk } from "ai";

const SANDBOX_TOOL_NAMES = capabilityNameSet("usesSandbox");
const DELIVERABLE_TOOL_NAMES = artifactPresentationNameSet("deliverable");
const TOOL_EVIDENCE_TOOL_NAMES = artifactPresentationNameSet("tool-evidence");

interface AgentToolCallUiPayload {
  args?: unknown;
  toolCallId: string;
  toolName: string;
}

interface AgentToolResultUiPayload extends AgentToolCallUiPayload {
  result: unknown;
}

interface AgentToolErrorUiPayload extends AgentToolCallUiPayload {
  error: unknown;
}
export function agentToolResultUiChunks(payload: AgentToolResultUiPayload): UIMessageChunk[] {
  if (payload.toolName === "skill_create") {
    const skill = skillCreatedChunkFromResult(payload.result);
    return skill ? [skill] : [];
  }
  const chunks = isSandboxTool(payload) ? [sandboxStatusChunk("ready")] : [];
  const output = toolOutputUiChunk(payload);
  if (output) {
    chunks.push(output);
  }
  return chunks;
}

function toolOutputUiChunk(payload: AgentToolResultUiPayload): UIMessageChunk | undefined {
  if (isDeliverableTool(payload)) {
    return artifactChunkFromResult(payload.result);
  }
  if (isToolEvidenceTool(payload)) {
    return toolEvidenceChunkFromResult(payload);
  }
  return undefined;
}

function skillCreatedChunkFromResult(result: unknown): UIMessageChunk | undefined {
  const record = asRecord(result);
  const name = stringField(record, "name");
  const description = stringField(record, "description");
  const filePath = stringField(record, "filePath");
  const id = stringField(record, "id");
  const slug = stringField(record, "slug");
  if (record["created"] !== true || !name || !description || !filePath || !id || !slug) {
    return undefined;
  }
  return {
    type: "data-skill-created",
    data: { description, filePath, id, name, slug, v: 1 },
  };
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
export function agentToolCallUiChunks(payload: AgentToolCallUiPayload): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [toolActivityChunk(payload)];
  if (SANDBOX_TOOL_NAMES.has(payload.toolName)) {
    chunks.push(sandboxStatusChunk("starting"));
  }
  return chunks;
}

export function agentToolErrorUiChunks(payload: AgentToolErrorUiPayload): UIMessageChunk[] {
  return isSandboxTool(payload) ? [sandboxStatusChunk("ready")] : [];
}

function toolActivityChunk(payload: AgentToolCallUiPayload): UIMessageChunk {
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
function toolInputFromPayload(
  payload: AgentToolCallUiPayload,
): Record<string, unknown> | undefined {
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

function isSandboxTool(payload: { toolName: string }): boolean {
  return SANDBOX_TOOL_NAMES.has(payload.toolName);
}

function isDeliverableTool(payload: { toolName: string }): boolean {
  return DELIVERABLE_TOOL_NAMES.has(payload.toolName);
}

function isToolEvidenceTool(payload: { toolName: string }): boolean {
  return TOOL_EVIDENCE_TOOL_NAMES.has(payload.toolName);
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

function toolEvidenceChunkFromResult(
  payload: AgentToolResultUiPayload,
): UIMessageChunk | undefined {
  const artifact = artifactRecordFromResult(payload.result);
  const outputId = stringField(artifact, "outputId");
  const kind = artifactKind(artifact);
  const mimeType = stringField(artifact, "mimeType");
  const filename = stringField(artifact, "filename");
  const sizeBytes = numberField(artifact, "sizeBytes");
  if (
    !outputId ||
    kind !== "image" ||
    !mimeType.startsWith("image/") ||
    !filename ||
    sizeBytes === undefined
  ) {
    return undefined;
  }
  return {
    type: "data-tool-evidence",
    data: {
      v: 1,
      filename,
      kind,
      mimeType,
      outputId,
      sizeBytes,
      toolCallId: payload.toolCallId,
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

function capabilityNameSet(flag: "usesSandbox"): ReadonlySet<string> {
  return new Set(
    TOOL_CAPABILITIES.filter((capability) => capability[flag]).map((capability) => capability.name),
  );
}

function artifactPresentationNameSet(
  presentation: "deliverable" | "tool-evidence",
): ReadonlySet<string> {
  return new Set(
    TOOL_CAPABILITIES.filter((capability) => capability.artifactPresentation === presentation).map(
      (capability) => capability.name,
    ),
  );
}
