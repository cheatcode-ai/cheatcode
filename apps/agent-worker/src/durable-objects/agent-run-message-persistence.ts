import { createDb, createThreadMessage, withUserContext } from "@cheatcode/db";
import type { Logger } from "@cheatcode/observability";
import type { UIMessagePart } from "@cheatcode/types";
import { AgentRunId, ThreadId, UserId } from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import { isMessagePartRow, parseSequencedChunk } from "../streaming/ui-message-stream";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PersistAssistantMessageInput {
  env: AgentRunEnv;
  input: StartRunInput;
  logger: Logger;
  rows: unknown[];
}

interface TextPartDraft {
  index: number;
  text: string;
}

export async function persistAssistantMessage({
  env,
  input,
  logger,
  rows,
}: PersistAssistantMessageInput): Promise<void> {
  if (!UUID_PATTERN.test(input.runId) || !UUID_PATTERN.test(input.threadId)) {
    return;
  }
  const parts = assistantPartsFromRows(rows);
  if (parts.length === 0) {
    return;
  }
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    await withUserContext(db, UserId(input.userId), (tx) =>
      createThreadMessage(tx, {
        agentRunId: AgentRunId(input.runId),
        parts,
        role: "assistant",
        threadId: ThreadId(input.threadId),
        userId: UserId(input.userId),
      }),
    );
  } catch (error) {
    logger.error("assistant_message_persist_failed", {
      error: error instanceof Error ? error.message : "Unknown error",
      runId: input.runId,
    });
  } finally {
    await close().catch((error: unknown) => {
      logger.warn("assistant_message_db_close_failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });
  }
}

function assistantPartsFromRows(rows: unknown[]): UIMessagePart[] {
  const output: UIMessagePart[] = [];
  const textParts = new Map<string, TextPartDraft>();
  for (const row of rows) {
    if (!isMessagePartRow(row)) {
      continue;
    }
    appendChunkPart(parseSequencedChunk(row).chunk, output, textParts);
  }
  return output.filter((part) => part.type !== "text" || textPartHasContent(part));
}

function appendChunkPart(
  chunk: UIMessageChunk,
  output: UIMessagePart[],
  textParts: Map<string, TextPartDraft>,
): void {
  if (chunk.type === "text-start") {
    ensureTextPart(chunk.id, output, textParts);
    return;
  }
  if (chunk.type === "text-delta") {
    const draft = ensureTextPart(chunk.id, output, textParts);
    draft.text += chunk.delta;
    output[draft.index] = { type: "text", text: draft.text, state: "streaming" };
    return;
  }
  if (chunk.type === "text-end") {
    const draft = ensureTextPart(chunk.id, output, textParts);
    output[draft.index] = { type: "text", text: draft.text, state: "done" };
    return;
  }
  if (chunk.type === "start-step") {
    output.push({ type: "step-start" });
    return;
  }
  if (isPersistableDataChunk(chunk) || isPersistableDisplayChunk(chunk)) {
    output.push(uiMessagePartFromChunk(chunk));
  }
}

function ensureTextPart(
  id: string,
  output: UIMessagePart[],
  textParts: Map<string, TextPartDraft>,
): TextPartDraft {
  const existing = textParts.get(id);
  if (existing) {
    return existing;
  }
  const draft = { index: output.length, text: "" };
  textParts.set(id, draft);
  output.push({ type: "text", text: "", state: "streaming" });
  return draft;
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

function isPersistableDisplayChunk(chunk: UIMessageChunk): boolean {
  return chunk.type === "file" || chunk.type === "source-url" || chunk.type === "source-document";
}

function uiMessagePartFromChunk(chunk: UIMessageChunk): UIMessagePart {
  return {
    ...chunkRecord(chunk),
    type: chunk.type,
  };
}

function chunkRecord(chunk: UIMessageChunk): Record<string, unknown> {
  return Object(chunk) as Record<string, unknown>;
}

function textPartHasContent(part: UIMessagePart): boolean {
  return typeof part["text"] === "string" && part["text"].trim().length > 0;
}
