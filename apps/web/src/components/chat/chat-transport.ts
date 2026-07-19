import { type CheatcodeUIMessage, ErrorResponseSchema } from "@cheatcode/types";
import { DefaultChatTransport } from "ai";
import {
  API_RESPONSE_LIMIT_BYTES,
  readBoundedTextResponse,
  waitForAbortSignal,
} from "@/lib/api/authorized-fetch";
import { gatewayRequestUrl } from "@/lib/api/gateway-url";
import { useAppStore } from "@/lib/store/app-store";

export type CheatcodeChatTransport = DefaultChatTransport<CheatcodeUIMessage> & {
  setCursorSource: (source: () => string) => void;
};

const CHAT_AUTH_TIMEOUT_MS = 30_000;

interface ReconnectRequest {
  api: string;
  headers: Record<string, string>;
}

export function createChatTransport(
  threadId: string,
  getToken: () => Promise<null | string>,
): CheatcodeChatTransport {
  let cursorSource = () => "0";
  const encodedThreadId = encodeURIComponent(threadId);
  const transport = new DefaultChatTransport<CheatcodeUIMessage>({
    api: gatewayRequestUrl(`/v1/threads/${encodedThreadId}/runs`),
    fetch: createBoundedChatFetch(getToken),
    prepareReconnectToStreamRequest: async (): Promise<ReconnectRequest> => {
      const cursor = cursorSource();
      if (cursor !== "0") {
        useAppStore.getState().setStreamReconnect({ at: Date.now(), fromSeq: Number(cursor) });
      }
      return {
        api: gatewayRequestUrl(
          `/v1/threads/${encodedThreadId}/runs/stream?lastSeq=${encodeURIComponent(cursor)}`,
        ),
        headers: {},
      };
    },
    prepareSendMessagesRequest: ({ body, headers, messageId, messages }) => {
      const latestMessage = messages.at(-1);
      return {
        body: {
          intent: body?.["intent"],
          message: runRequestMessage(latestMessage),
          model: body?.["model"],
        },
        headers: {
          ...headers,
          "Idempotency-Key": runIdempotencyKey(threadId, messageId ?? latestMessage?.id),
        },
      };
    },
  });
  return Object.assign(transport, {
    setCursorSource(source: () => string) {
      cursorSource = source;
    },
  });
}

function runRequestMessage(message: CheatcodeUIMessage | undefined): {
  id?: string;
  parts: [{ text: string; type: "text" }];
  role: "user";
} {
  const textPart = message?.parts.find((part) => part.type === "text");
  if (message?.role !== "user" || !textPart || textPart.type !== "text") {
    throw new Error("A user text message is required to start a run");
  }
  return {
    id: message.id,
    parts: [{ text: textPart.text, type: "text" }],
    role: "user",
  };
}

export function chatErrorMessage(message: string): string {
  const parsedResponse = ErrorResponseSchema.safeParse(safeJsonParse(message));
  if (!parsedResponse.success) {
    return message;
  }
  const hint = parsedResponse.data.error.hint;
  return hint ? `${parsedResponse.data.error.message}. ${hint}` : parsedResponse.data.error.message;
}

function createBoundedChatFetch(getToken: () => Promise<null | string>) {
  return async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const timeout = AbortSignal.timeout(CHAT_AUTH_TIMEOUT_MS);
    const authSignal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const token = await waitForAbortSignal(getToken(), authSignal);
    if (!token) {
      throw new Error("Authentication token is unavailable");
    }
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await globalThis.fetch(input, { ...init, headers });
    if (response.ok) {
      return response;
    }
    const body = await readBoundedTextResponse(response, API_RESPONSE_LIMIT_BYTES.error);
    return new Response(body, { status: response.status, statusText: response.statusText });
  };
}

function runIdempotencyKey(threadId: string, messageId: string | undefined): string {
  const key = `run-${threadId}-${messageId ?? crypto.randomUUID()}`;
  return key.length <= 255 ? key : key.slice(0, 255);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
