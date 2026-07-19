const MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024 * 1024;
const STREAMING_CONTENT_TYPES = new Set(["application/x-ndjson", "text/event-stream"]);

/**
 * Bound buffered provider responses without imposing a limit on streamed model output.
 * AI SDK JSON handlers otherwise accept multi-gigabyte bodies before parsing them.
 */
export const boundedProviderFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (!response.body || isStreamingResponse(response)) {
    return response;
  }
  await rejectOversizedDeclaredResponse(response);
  return new Response(limitResponseBody(response.body), response);
};

function isStreamingResponse(response: Response): boolean {
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType ? STREAMING_CONTENT_TYPES.has(contentType) : false;
}

async function rejectOversizedDeclaredResponse(response: Response): Promise<void> {
  const rawLength = response.headers.get("Content-Length");
  if (!rawLength) {
    return;
  }
  const length = Number(rawLength);
  if (Number.isSafeInteger(length) && length > MAX_PROVIDER_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw providerResponseTooLarge();
  }
}

function limitResponseBody(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let receivedBytes = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > MAX_PROVIDER_RESPONSE_BYTES) {
          controller.error(providerResponseTooLarge());
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

function providerResponseTooLarge(): Error {
  return new Error("Provider response exceeded the non-streaming response safety limit");
}
