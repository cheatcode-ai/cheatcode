import { type CheatcodeUIMessage, ErrorResponseSchema } from "@cheatcode/types";
import { DefaultChatTransport } from "ai";
import { API_RESPONSE_LIMIT_BYTES, readBoundedTextResponse } from "@/lib/api/authorized-fetch";
import { gatewayRequestUrl } from "@/lib/api/gateway-url";
import { useAppStore } from "@/lib/store/app-store";

export type CheatcodeChatTransport = DefaultChatTransport<CheatcodeUIMessage> & {
  setCursorSource: (source: () => string) => void;
};

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
    fetch: boundedChatFetch,
    headers: async () => {
      const token = await getToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
    prepareReconnectToStreamRequest: async (): Promise<ReconnectRequest> => {
      const token = await getToken();
      const cursor = cursorSource();
      if (cursor !== "0") {
        useAppStore.getState().setStreamReconnect({ at: Date.now(), fromSeq: Number(cursor) });
      }
      return {
        api: gatewayRequestUrl(
          `/v1/threads/${encodedThreadId}/runs/stream?lastSeq=${encodeURIComponent(cursor)}`,
        ),
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      };
    },
    prepareSendMessagesRequest: ({ body, headers, messageId, messages }) => ({
      body: {
        message: messages.at(-1),
        model: body?.["model"],
      },
      headers: {
        ...headers,
        "Idempotency-Key": runIdempotencyKey(threadId, messageId ?? messages.at(-1)?.id),
      },
    }),
  });
  return Object.assign(transport, {
    setCursorSource(source: () => string) {
      cursorSource = source;
    },
  });
}

export function chatErrorMessage(message: string): string {
  const parsedResponse = ErrorResponseSchema.safeParse(safeJsonParse(message));
  if (!parsedResponse.success) {
    return message;
  }
  const hint = parsedResponse.data.error.hint;
  return hint ? `${parsedResponse.data.error.message}. ${hint}` : parsedResponse.data.error.message;
}

async function boundedChatFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await globalThis.fetch(input, init);
  if (response.ok) {
    return response;
  }
  const body = await readBoundedTextResponse(response, API_RESPONSE_LIMIT_BYTES.error);
  return new Response(body, { status: response.status, statusText: response.statusText });
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
