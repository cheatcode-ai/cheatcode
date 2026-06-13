import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";

export interface MessagePartRow {
  seq: number;
  payload_json: string;
}

export interface SequencedUIMessageChunk {
  chunk: UIMessageChunk;
  seq: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function isMessagePartRow(value: unknown): value is MessagePartRow {
  return (
    isRecord(value) && typeof value["seq"] === "number" && typeof value["payload_json"] === "string"
  );
}

export function isSeqRow(value: unknown): value is { seq: number } {
  return isRecord(value) && typeof value["seq"] === "number";
}

export function parseSequencedChunk(row: MessagePartRow): SequencedUIMessageChunk {
  const parsed = JSON.parse(row.payload_json) as unknown;
  if (!isRecord(parsed) || typeof parsed["type"] !== "string") {
    throw new Error("Stored message part is not a UIMessage chunk.");
  }
  return { chunk: parsed as UIMessageChunk, seq: row.seq };
}

export function createSeqChunk(seq: number): UIMessageChunk {
  return {
    type: "data-seq",
    data: { v: 1, seq },
    transient: true,
  };
}

export function createAgentStreamResponse(options: {
  status?: number;
  stream: ReadableStream<UIMessageChunk>;
}): Response {
  if (options.status === undefined) {
    return createUIMessageStreamResponse({ stream: options.stream });
  }
  return createUIMessageStreamResponse({ status: options.status, stream: options.stream });
}
