import { APIError } from "./errors";

const DEFAULT_MAX_JSON_BODY_BYTES = 16 * 1024 * 1024;

interface BoundedBodySource {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly headers: Headers;
}

/** Read a request body without allowing an unbounded allocation. */
export async function readBoundedRequestText(
  request: Request,
  maxBytes: number,
  label = "Request",
): Promise<string> {
  return readBoundedBodyText(request, maxBytes, () => bodyTooLarge(label));
}

/** Parses bounded JSON without turning malformed client input into a 500. */
export async function readJsonRequest(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BODY_BYTES,
  label?: string,
): Promise<unknown> {
  const rawBody = await readBoundedRequestText(request, maxBytes, label ?? "JSON request");
  try {
    return JSON.parse(rawBody) as unknown;
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new APIError(
      400,
      "invalid_request_body",
      label ? `${label} must be valid JSON` : "Request body must be valid JSON",
      {
        retriable: false,
      },
    );
  }
}

/** Read an upstream response without allowing provider-controlled allocation. */
export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  label = "Upstream provider",
): Promise<string> {
  return readBoundedBodyText(response, maxBytes, () => upstreamResponseTooLarge(label));
}

/** Wrap an SDK response stream so its parser cannot allocate past the configured limit. */
export async function withBoundedResponseBody(
  response: Response,
  maxBytes: number,
  label = "Upstream provider",
): Promise<Response> {
  validateMaxBytes(maxBytes);
  if (declaredBodyIsTooLarge(response, maxBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw upstreamResponseTooLarge(label);
  }
  if (!response.body) {
    return response;
  }

  let totalBytes = 0;
  const boundedBody = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          throw upstreamResponseTooLarge(label);
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(boundedBody, response);
}

/** Parse bounded upstream JSON and map malformed payloads to a stable provider error. */
export async function readBoundedResponseJson(
  response: Response,
  maxBytes: number,
  label = "Upstream provider",
): Promise<unknown> {
  const rawBody = await readBoundedResponseText(response, maxBytes, label);
  try {
    return JSON.parse(rawBody) as unknown;
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new APIError(502, "upstream_provider_outage", `${label} returned invalid JSON`, {
      retriable: true,
    });
  }
}

async function readBoundedBodyText(
  source: BoundedBodySource,
  maxBytes: number,
  tooLarge: () => APIError,
): Promise<string> {
  validateMaxBytes(maxBytes);
  if (declaredBodyIsTooLarge(source, maxBytes)) {
    await source.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!source.body) {
    return "";
  }

  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function declaredBodyIsTooLarge(source: BoundedBodySource, maxBytes: number): boolean {
  const declaredLengthHeader = source.headers.get("content-length");
  const declaredLength = declaredLengthHeader === null ? null : Number(declaredLengthHeader);
  return declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > maxBytes;
}

function validateMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxBytes must be a positive safe integer");
  }
}

function bodyTooLarge(label: string): APIError {
  return new APIError(413, "invalid_request_body", `${label} body is too large`, {
    retriable: false,
  });
}

function upstreamResponseTooLarge(label: string): APIError {
  return new APIError(502, "upstream_provider_outage", `${label} response is too large`, {
    hint: "Retry with a narrower request.",
    retriable: false,
  });
}
