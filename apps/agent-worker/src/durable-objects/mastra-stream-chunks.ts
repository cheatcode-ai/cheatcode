import type { UIMessageChunk } from "ai";

const ANSWER_TEXT_ID = "answer";
const SANDBOX_TOOL_NAMES = new Set([
  "browser_act",
  "browser_extract",
  "browser_observe",
  "browser_open",
  "browser_screenshot",
  "data_chart",
  "docs_generate_docx",
  "docs_generate_pdf",
  "docs_generate_slides",
  "docs_generate_xlsx",
  "fs_delete",
  "fs_list",
  "fs_read",
  "fs_search",
  "fs_write",
  "git_clone",
  "git_commit",
  "git_push",
  "git_status",
  "runCode",
  "sandbox_create",
  "sandbox_destroy",
  "sandbox_restore",
  "sandbox_snapshot",
  "shell_exec",
  "shell_kill_process",
  "shell_start_process",
  "shell_terminal",
  "start_dev_server",
]);

const ARTIFACT_TOOL_NAMES = new Set([
  "data_chart",
  "docs_generate_docx",
  "docs_generate_pdf",
  "docs_generate_slides",
  "docs_generate_xlsx",
]);

export interface MastraUsageDelta {
  costUsd: number | undefined;
  tokensIn: number;
  tokensOut: number;
}

export function mastraChunkToUiChunks(chunk: unknown): UIMessageChunk[] {
  const record = asRecord(chunk);
  const chunkType = stringField(record, "type");

  if (chunkType === "text-delta") {
    return textDeltaChunks(record);
  }

  if (chunkType === "tool-call") {
    return toolCallChunks(record);
  }

  if (chunkType === "tool-result" && isSandboxToolChunk(record)) {
    const payload = chunkPayload(record);
    const chunks = [sandboxStatusChunk("ready", previewUrlFromPayload(payload))];
    if (isArtifactToolChunk(record)) {
      const artifact = artifactChunkFromPayload(payload);
      if (artifact) {
        chunks.push(artifact);
      }
    }
    return chunks;
  }

  if (chunkType === "tool-result" && isArtifactToolChunk(record)) {
    const payload = chunkPayload(record);
    const artifact = artifactChunkFromPayload(payload);
    return artifact ? [artifact] : [];
  }

  return [];
}

export function usageFromMastraChunk(chunk: unknown): MastraUsageDelta | null {
  const record = asRecord(chunk);
  const chunkType = stringField(record, "type");
  if (chunkType !== "finish" && chunkType !== "finish-step" && chunkType !== "step-finish") {
    return null;
  }

  const usage = usageRecord(record);
  const tokensIn = tokenCount(usage, ["inputTokens", "promptTokens", "input_tokens"]);
  const tokensOut = tokenCount(usage, ["outputTokens", "completionTokens", "output_tokens"]);
  if (tokensIn === 0 && tokensOut === 0) {
    return null;
  }
  return { costUsd: gatewayReportedCostUsd(record, usage), tokensIn, tokensOut };
}

// Prefer the gateway's own USD cost when present (OpenRouter reports it per generation) so the
// dynamic price-map fallback is only used when the provider returns tokens but no cost.
function gatewayReportedCostUsd(
  record: Record<string, unknown>,
  usage: Record<string, unknown>,
): number | undefined {
  const payload = asRecord(record["payload"]);
  const openrouterUsage = asRecord(
    asRecord(asRecord(record["providerMetadata"])["openrouter"])["usage"],
  );
  const openrouterPayloadUsage = asRecord(
    asRecord(asRecord(payload["providerMetadata"])["openrouter"])["usage"],
  );
  for (const candidate of [usage, openrouterUsage, openrouterPayloadUsage]) {
    const cost = positiveNumber(candidate, ["cost", "costUsd", "totalCost"]);
    if (cost !== undefined) {
      return cost;
    }
  }
  return undefined;
}

function positiveNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return undefined;
}

export function mastraChunkError(chunk: unknown): unknown | null {
  const record = asRecord(chunk);
  if (stringField(record, "type") !== "error") {
    return null;
  }
  return record["error"] ?? new Error("Unknown Mastra stream error.");
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

function usageRecord(record: Record<string, unknown>): Record<string, unknown> {
  const payload = asRecord(record["payload"]);
  const metadata = asRecord(payload["metadata"]);
  const candidates: Record<string, unknown>[] = [
    asRecord(record["usage"]),
    asRecord(record["totalUsage"]),
    asRecord(payload["usage"]),
    asRecord(payload["totalUsage"]),
  ];
  // Mastra 1.x finish chunks nest the raw provider usage under
  // payload.metadata.providerMetadata.<provider>.usage (snake_case token fields),
  // with no normalized top-level usage — so dig through every provider entry.
  for (const providerMetadata of [
    asRecord(record["providerMetadata"]),
    asRecord(payload["providerMetadata"]),
    asRecord(metadata["providerMetadata"]),
  ]) {
    for (const providerValue of Object.values(providerMetadata)) {
      candidates.push(asRecord(asRecord(providerValue)["usage"]));
    }
  }
  for (const candidate of candidates) {
    if (Object.keys(candidate).length > 0) {
      return candidate;
    }
  }
  return {};
}

function tokenCount(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value;
    }
  }
  return 0;
}

function textDeltaChunks(record: Record<string, unknown>): UIMessageChunk[] {
  const payload = chunkPayload(record);
  const text =
    stringField(payload, "text") ||
    stringField(payload, "textDelta") ||
    stringField(payload, "delta");
  if (text.length === 0) {
    return [];
  }
  return [{ type: "text-delta", id: ANSWER_TEXT_ID, delta: text }];
}

function sandboxStatusChunk(status: "ready" | "starting", previewUrl?: string): UIMessageChunk {
  return {
    type: "data-sandbox-status",
    data: previewUrl ? { v: 1, status, previewUrl } : { v: 1, status },
  };
}

const MAX_TOOL_INPUT_KEYS = 8;
const MAX_TOOL_INPUT_STRING = 256;

// Surface every tool call as a transcript row (bud parity). Sandbox tools also drive
// the Computer-panel status; non-sandbox tools only get the row.
function toolCallChunks(record: Record<string, unknown>): UIMessageChunk[] {
  const payload = chunkPayload(record);
  const toolName = stringField(payload, "toolName");
  if (!toolName) {
    return [];
  }
  const chunks: UIMessageChunk[] = [toolActivityChunk(payload, toolName)];
  if (SANDBOX_TOOL_NAMES.has(toolName)) {
    chunks.push(sandboxStatusChunk("starting"));
  }
  return chunks;
}

function toolActivityChunk(payload: Record<string, unknown>, toolName: string): UIMessageChunk {
  const toolCallId = stringField(payload, "toolCallId");
  const input = toolInputFromPayload(payload);
  return {
    type: "data-tool",
    data: {
      v: 1,
      toolName,
      ...(toolCallId ? { toolCallId } : {}),
      ...(input ? { input } : {}),
    },
  };
}

// Keep the persisted part small: only scalar args, capped count + string length. The
// transcript row needs the path/command/url/query, not the full (possibly huge) payload.
function toolInputFromPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  for (const key of ["args", "input", "toolInput", "arguments"]) {
    const raw = asRecord(payload[key]);
    if (Object.keys(raw).length > 0) {
      return truncateToolInput(raw);
    }
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
  // line — that is what the "Ran <command>" transcript row shows (bud parity). Non-string
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

function isSandboxToolChunk(record: Record<string, unknown>): boolean {
  const payload = chunkPayload(record);
  return SANDBOX_TOOL_NAMES.has(stringField(payload, "toolName"));
}

function isArtifactToolChunk(record: Record<string, unknown>): boolean {
  const payload = chunkPayload(record);
  return ARTIFACT_TOOL_NAMES.has(stringField(payload, "toolName"));
}

function chunkPayload(record: Record<string, unknown>): Record<string, unknown> {
  const payload = asRecord(record["payload"]);
  return Object.keys(payload).length > 0 ? payload : record;
}

function previewUrlFromPayload(payload: Record<string, unknown>): string | undefined {
  const output = asRecord(payload["output"]);
  const result = asRecord(payload["result"]);
  return stringField(output, "previewUrl") || stringField(result, "previewUrl") || undefined;
}

function artifactChunkFromPayload(payload: Record<string, unknown>): UIMessageChunk | undefined {
  const artifact = artifactRecordFromPayload(payload);
  const outputId = stringField(artifact, "outputId");
  const kind = artifactKind(artifact);
  const downloadUrl = stringField(artifact, "downloadUrl");
  const mimeType = stringField(artifact, "mimeType");
  const filename = stringField(artifact, "filename");
  const sizeBytes = numberField(artifact, "sizeBytes");
  if (!outputId || !kind || !downloadUrl || !mimeType) {
    return undefined;
  }
  return {
    type: "data-artifact",
    data: {
      v: 1,
      downloadUrl,
      ...(filename ? { filename } : {}),
      kind,
      mimeType,
      outputId,
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    },
  };
}

function artifactRecordFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const output = asRecord(payload["output"]);
  if (stringField(output, "downloadUrl")) {
    return output;
  }
  const outputArtifact = asRecord(output["artifact"]);
  if (stringField(outputArtifact, "downloadUrl")) {
    return outputArtifact;
  }
  const result = asRecord(payload["result"]);
  if (stringField(result, "downloadUrl")) {
    return result;
  }
  const resultArtifact = asRecord(result["artifact"]);
  if (stringField(resultArtifact, "downloadUrl")) {
    return resultArtifact;
  }
  return result;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function artifactKind(
  record: Record<string, unknown>,
): "audio" | "docx" | "image" | "pdf" | "slide" | "video" | "xlsx" | undefined {
  const value = stringField(record, "kind");
  if (
    value === "audio" ||
    value === "docx" ||
    value === "image" ||
    value === "pdf" ||
    value === "slide" ||
    value === "video" ||
    value === "xlsx"
  ) {
    return value;
  }
  return undefined;
}
