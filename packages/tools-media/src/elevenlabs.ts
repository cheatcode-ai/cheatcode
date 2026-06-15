import { APIError } from "@cheatcode/observability";
import type { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { z } from "zod/v4";
import { storeBytesMediaArtifact } from "./artifacts";
import type { MediaRuntimeContext } from "./runtime";
import { mediaFetch, requireMediaProviderKey } from "./runtime";
import {
  ElevenLabsTranscriptionInputSchema,
  type ElevenLabsTranscriptionOutput,
  ElevenLabsTranscriptionOutputSchema,
  ElevenLabsTtsInputSchema,
  type ElevenLabsTtsOutput,
  ElevenLabsTtsOutputSchema,
} from "./schemas";

type TextToSpeechRequest = Parameters<ElevenLabsClient["textToSpeech"]["convert"]>[1];
type SpeechToTextRequest = Parameters<ElevenLabsClient["speechToText"]["convert"]>[0];

export interface ElevenLabsClientLike {
  speechToText: {
    convert(input: SpeechToTextRequest): Promise<unknown>;
  };
  textToSpeech: {
    convert(voiceId: string, input: TextToSpeechRequest): Promise<unknown>;
  };
}

const TranscriptionResponseSchema = z
  .object({
    languageCode: z.string().optional(),
    language_code: z.string().optional(),
    text: z.string(),
  })
  .passthrough();

export async function executeElevenLabsTts(
  input: unknown,
  runtimeContext: MediaRuntimeContext,
  client?: ElevenLabsClientLike,
): Promise<ElevenLabsTtsOutput> {
  const resolvedClient = client ?? (await createElevenLabsClient(runtimeContext));
  const parsedInput = ElevenLabsTtsInputSchema.parse(input);
  const request: TextToSpeechRequest = {
    modelId: parsedInput.modelId,
    outputFormat: parsedInput.outputFormat,
    text: parsedInput.text,
  };
  const audio = await resolvedClient.textToSpeech.convert(parsedInput.voiceId, request);
  const contentType = outputFormatContentType(parsedInput.outputFormat);
  const artifact = await storeBytesMediaArtifact({
    contentType,
    data: await binaryContentToBytes(audio),
    filename: parsedInput.filename ?? "elevenlabs-tts.mp3",
    kind: "audio",
    metadata: {
      modelId: parsedInput.modelId,
      outputFormat: parsedInput.outputFormat,
      provider: "elevenlabs",
      voiceId: parsedInput.voiceId,
    },
    runtimeContext,
  });
  return ElevenLabsTtsOutputSchema.parse({
    ...artifact,
    kind: "audio",
    modelId: parsedInput.modelId,
    provider: "elevenlabs",
    voiceId: parsedInput.voiceId,
  });
}

export async function executeElevenLabsTranscription(
  input: unknown,
  runtimeContext: MediaRuntimeContext,
  client?: ElevenLabsClientLike,
): Promise<ElevenLabsTranscriptionOutput> {
  const resolvedClient = client ?? (await createElevenLabsClient(runtimeContext));
  const parsedInput = ElevenLabsTranscriptionInputSchema.parse(input);
  const audio = await transcriptionAudio(parsedInput, runtimeContext);
  const request: SpeechToTextRequest = {
    file: new File([bytesToArrayBuffer(audio)], parsedInput.filename, {
      type: parsedInput.mimeType,
    }),
    modelId: parsedInput.modelId,
  };
  if (parsedInput.languageCode) {
    request["languageCode"] = parsedInput.languageCode;
  }
  const response = TranscriptionResponseSchema.parse(
    await resolvedClient.speechToText.convert(request),
  );
  return ElevenLabsTranscriptionOutputSchema.parse({
    languageCode: response.languageCode ?? response.language_code,
    modelId: parsedInput.modelId,
    provider: "elevenlabs",
    text: response.text,
  });
}

// Dynamically imported so the 6.5 MB ElevenLabs SDK is a lazy chunk — kept out
// of the agent-worker isolate's startup path (CF startup CPU limit). Only loaded
// when a TTS/STT tool actually fires.
async function createElevenLabsClient(
  runtimeContext: MediaRuntimeContext,
): Promise<ElevenLabsClientLike> {
  const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
  return new ElevenLabsClient({
    apiKey: requireMediaProviderKey(runtimeContext, "elevenlabs"),
  });
}

async function transcriptionAudio(
  input: z.infer<typeof ElevenLabsTranscriptionInputSchema>,
  runtimeContext: MediaRuntimeContext,
): Promise<Uint8Array> {
  if (input.audioBase64) {
    return base64ToBytes(input.audioBase64);
  }
  if (!input.audioUrl) {
    throw new APIError(400, "tool_validation_failed", "Missing transcription audio", {
      retriable: false,
    });
  }
  const response = await mediaFetch(runtimeContext)(input.audioUrl);
  if (!response.ok) {
    throw new APIError(502, "upstream_provider_outage", "Transcription audio download failed", {
      details: { status: response.status },
      retriable: true,
    });
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function binaryContentToBytes(value: unknown): Promise<Uint8Array> {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  if (value instanceof ReadableStream) {
    return new Uint8Array(await new Response(value).arrayBuffer());
  }
  if (isArrayBufferSource(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (isAsyncIterable(value)) {
    return collectAsyncIterable(value);
  }
  throw new APIError(502, "upstream_provider_outage", "ElevenLabs returned unsupported audio", {
    retriable: true,
  });
}

async function collectAsyncIterable(value: AsyncIterable<unknown>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of value) {
    chunks.push(await binaryContentToBytes(chunk));
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function isArrayBufferSource(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

function outputFormatContentType(format: string): string {
  if (format.startsWith("pcm_")) {
    return "audio/wav";
  }
  if (format.startsWith("ulaw_")) {
    return "audio/basic";
  }
  return "audio/mpeg";
}
