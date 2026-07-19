import { fragmentMessagePart, parseMessagePart, type UIMessagePart } from "@cheatcode/types";
import type { UIMessageChunk } from "ai";

export const AGENT_RUN_MESSAGE_PART_MAX_BYTES = 64 * 1024;
const TEXT_CHUNK_MAX_CHARACTERS = 8 * 1024;

/** Normalizes one event into lossless SQLite/stream units with a fixed per-event byte bound. */
export function* boundedAgentRunChunks(
  chunk: UIMessageChunk,
  fragmentId: string,
): Generator<UIMessageChunk, void> {
  if (serializedChunkBytes(chunk) <= AGENT_RUN_MESSAGE_PART_MAX_BYTES) {
    yield chunk;
    return;
  }
  if (chunk.type === "text-delta") {
    yield* boundedTextDeltaChunks(chunk);
    return;
  }
  const part = transcriptPartFromChunk(chunk);
  if (!part) {
    throw new RangeError(`UI stream event ${chunk.type} exceeds the per-event byte bound.`);
  }
  for (const fragment of fragmentMessagePart(part, fragmentId)) {
    const fragmentChunk = fragment as UIMessageChunk;
    assertChunkBound(fragmentChunk);
    yield fragmentChunk;
  }
}

export function transcriptPartFromChunk(chunk: UIMessageChunk): UIMessagePart | null {
  if (isPersistableDataChunk(chunk)) {
    return uiMessagePartFromChunk(chunk);
  }
  return null;
}

export function serializedChunkBytes(chunk: UIMessageChunk): number {
  return new TextEncoder().encode(JSON.stringify(chunk)).byteLength;
}

function* boundedTextDeltaChunks(
  chunk: Extract<UIMessageChunk, { type: "text-delta" }>,
): Generator<UIMessageChunk, void> {
  let offset = 0;
  while (offset < chunk.delta.length) {
    const end = safeSliceEnd(chunk.delta, offset, TEXT_CHUNK_MAX_CHARACTERS);
    const bounded = { ...chunk, delta: chunk.delta.slice(offset, end) };
    assertChunkBound(bounded);
    yield bounded;
    offset = end;
  }
}

function assertChunkBound(chunk: UIMessageChunk): void {
  if (serializedChunkBytes(chunk) > AGENT_RUN_MESSAGE_PART_MAX_BYTES) {
    throw new RangeError(`Normalized UI stream event ${chunk.type} exceeds the byte bound.`);
  }
}

function isPersistableDataChunk(
  chunk: UIMessageChunk,
): chunk is UIMessageChunk & { type: `data-${string}` } {
  const value = chunkRecord(chunk);
  return (
    typeof value["type"] === "string" &&
    value["type"].startsWith("data-") &&
    value["type"] !== "data-seq" &&
    value["transient"] !== true
  );
}

function uiMessagePartFromChunk(chunk: UIMessageChunk): UIMessagePart {
  const value = chunkRecord(chunk);
  return validatedMessagePart({
    type: chunk.type,
    data: value["data"],
    ...(typeof value["id"] === "string" ? { id: value["id"] } : {}),
  });
}

function validatedMessagePart(value: unknown): UIMessagePart {
  return parseMessagePart(value);
}

function chunkRecord(chunk: UIMessageChunk): Record<string, unknown> {
  return Object(chunk) as Record<string, unknown>;
}

function safeSliceEnd(value: string, offset: number, maxCharacters: number): number {
  const candidate = Math.min(value.length, offset + maxCharacters);
  if (candidate === value.length) {
    return candidate;
  }
  const previous = value.charCodeAt(candidate - 1);
  const next = value.charCodeAt(candidate);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? candidate - 1
    : candidate;
}
