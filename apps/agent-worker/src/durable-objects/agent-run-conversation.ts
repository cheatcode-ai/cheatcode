import {
  createDb,
  listRecentThreadContextMessages,
  type ThreadContextMessageRecord,
  withUserContext,
} from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { type CheatcodeUIMessage, ThreadId, UIMessageRecordSchema, UserId } from "@cheatcode/types";
import { convertToModelMessages, type ModelMessage } from "ai";
import { z } from "zod";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";

const THREAD_CONTEXT_MAX_MESSAGES = 33;
const THREAD_CONTEXT_MAX_SERIALIZED_BYTES = 256 * 1024;
const ConversationMessageSchema = UIMessageRecordSchema.extend({
  role: z.enum(["assistant", "user"]),
});

type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
type ConversationUIMessage = Omit<CheatcodeUIMessage, "id">;

export interface ThreadModelContext {
  messages: ModelMessage[];
  persistedMessageCount: number;
  serializedBytes: number;
}

/** Loads and converts the bounded persisted transcript for one model turn. */
export async function loadThreadModelContext(
  env: AgentRunEnv,
  input: StartRunInput,
  agentContextNote?: string,
): Promise<ThreadModelContext> {
  const rows = await readContextRows(env, input);
  const records = rows.map(parseConversationMessage);
  assertCurrentUserTurn(records, input);
  const uiMessages = appendCurrentTurnNote(records.map(toUIMessage), agentContextNote);
  const converted = await convertToModelMessages<CheatcodeUIMessage>(uiMessages, {
    convertDataPart: () => undefined,
    ignoreIncompleteToolCalls: true,
  });
  const messages = usableModelSuffix(converted);
  if (messages.at(-1)?.role !== "user") {
    throw staleThreadContextError();
  }
  return {
    messages,
    persistedMessageCount: records.length,
    serializedBytes: rows.reduce((total, row) => total + row.serializedBytes, 0),
  };
}

async function readContextRows(
  env: AgentRunEnv,
  input: StartRunInput,
): Promise<ThreadContextMessageRecord[]> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    return await withUserContext(db, UserId(input.userId), (tx) =>
      listRecentThreadContextMessages(tx, {
        maxMessages: THREAD_CONTEXT_MAX_MESSAGES,
        maxSerializedBytes: THREAD_CONTEXT_MAX_SERIALIZED_BYTES,
        threadId: ThreadId(input.threadId),
        userId: UserId(input.userId),
      }),
    );
  } finally {
    await close();
  }
}

function parseConversationMessage(row: ThreadContextMessageRecord): ConversationMessage {
  return ConversationMessageSchema.parse({
    agentRunId: row.agentRunId,
    agentRunSegment: row.agentRunSegment,
    agentRunSegmentFinal: row.agentRunSegmentFinal,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    parts: row.parts,
    role: row.role,
    threadId: row.threadId,
  });
}

function assertCurrentUserTurn(records: ConversationMessage[], input: StartRunInput): void {
  const current = records.at(-1);
  if (
    current?.role !== "user" ||
    current.agentRunId !== input.runId ||
    current.threadId !== input.threadId ||
    userMessageText(current) !== input.messageText
  ) {
    throw staleThreadContextError();
  }
  if (records.some((record) => record.threadId !== input.threadId)) {
    throw staleThreadContextError();
  }
}

function userMessageText(message: ConversationMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function toUIMessage(message: ConversationMessage): ConversationUIMessage {
  return { parts: modelRelevantParts(message), role: message.role };
}

function modelRelevantParts(message: ConversationMessage): ConversationUIMessage["parts"] {
  const parts: ConversationUIMessage["parts"] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      parts.push({
        ...(part.state === undefined ? {} : { state: part.state }),
        text: part.text,
        type: "text",
      });
    }
  }
  return parts;
}

function appendCurrentTurnNote(
  messages: ConversationUIMessage[],
  note: string | undefined,
): ConversationUIMessage[] {
  if (!note) {
    return messages;
  }
  return messages.map((message, index) =>
    index === messages.length - 1
      ? { ...message, parts: [...message.parts, { text: `\n\n${note}`, type: "text" }] }
      : message,
  );
}

function usableModelSuffix(messages: ModelMessage[]): ModelMessage[] {
  const nonEmpty = messages.filter(modelMessageHasContent);
  const firstUserIndex = nonEmpty.findIndex((message) => message.role === "user");
  return firstUserIndex < 0 ? [] : nonEmpty.slice(firstUserIndex);
}

function modelMessageHasContent(message: ModelMessage): boolean {
  return typeof message.content === "string"
    ? message.content.trim().length > 0
    : message.content.length > 0;
}

function staleThreadContextError(): APIError {
  return new APIError(409, "conflict_state_invalid", "The run transcript changed before start.", {
    hint: "Retry the request so the agent can load a consistent current conversation.",
    retriable: true,
  });
}
