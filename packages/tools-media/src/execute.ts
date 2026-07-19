import { APIError } from "@cheatcode/observability";
import type { ArtifactUploadResult, CodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import { GoogleGenAI, type Image, type Video, VideoGenerationReferenceType } from "@google/genai";
import { z } from "zod";
import {
  type GenerateOrEditMediaInput,
  GenerateOrEditMediaInputSchema,
  type GenerateOrEditMediaOutput,
  GenerateOrEditMediaOutputSchema,
} from "./schemas";

const IMAGE_MODEL = "gemini-3.1-flash-image";
const VIDEO_MODEL = "veo-3.1-generate-preview";
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 32 * 1024 * 1024;
const VIDEO_POLL_INTERVAL_MS = 10_000;
const VIDEO_POLL_LIMIT = 60;

interface GeneratedMedia {
  bytes: Uint8Array;
  extension: string;
  mimeType: string;
  model: string;
}

interface MediaReference {
  base64: string;
  mimeType: string;
}

const InteractionStepsSchema = z.array(
  z
    .object({
      content: z
        .array(
          z
            .object({
              data: z.string().optional(),
              mime_type: z.string().optional(),
              type: z.string(),
            })
            .passthrough(),
        )
        .optional(),
      type: z.string(),
    })
    .passthrough(),
);

export async function executeGenerateOrEditMedia(
  input: GenerateOrEditMediaInput,
  runtimeContext: CodeRuntimeContext,
  googleApiKey: string,
): Promise<GenerateOrEditMediaOutput> {
  const parsed = GenerateOrEditMediaInputSchema.parse(input);
  const apiKey = requiredApiKey(googleApiKey);
  const client = new GoogleGenAI({ apiKey });
  const media =
    parsed.type === "image"
      ? await generateImage(client, parsed, runtimeContext)
      : await generateVideo(client, apiKey, parsed, runtimeContext);
  const filename = generatedFilename(parsed.prompt, media.extension);
  const sandboxPath = await writeMediaToWorkspace(
    runtimeContext,
    parsed.type,
    filename,
    media.bytes,
  );
  const artifact = await storeArtifact(runtimeContext, parsed.type, filename, media);
  return GenerateOrEditMediaOutputSchema.parse({
    artifact,
    model: media.model,
    sandboxPath,
    type: parsed.type,
  });
}

async function generateImage(
  client: GoogleGenAI,
  input: GenerateOrEditMediaInput,
  runtime: CodeRuntimeContext,
): Promise<GeneratedMedia> {
  const references = await loadReferences(input.reference_images ?? [], runtime);
  const interaction = await client.interactions.create({
    generation_config: input.aspect_ratio
      ? { image_config: { aspect_ratio: input.aspect_ratio } }
      : undefined,
    input: imageInteractionInput(imagePrompt(input), references),
    model: IMAGE_MODEL,
    response_modalities: ["image"],
  });
  const completed =
    interaction.status === "in_progress"
      ? await waitForImageInteraction(client, interaction.id)
      : interaction;
  const image = extractInteractionImage(completed.steps);
  if (!image) {
    throw upstreamMediaError("Image generation completed without an image.");
  }
  return generatedMedia(image.base64, image.mimeType, IMAGE_MODEL);
}

function imageInteractionInput(prompt: string, references: MediaReference[]) {
  if (references.length === 0) {
    return prompt;
  }
  return [
    { type: "text" as const, text: prompt },
    ...references.map((reference) => ({
      data: reference.base64,
      mime_type: reference.mimeType,
      type: "image" as const,
    })),
  ];
}

function imagePrompt(input: GenerateOrEditMediaInput): string {
  if (!input.reference_images?.length) {
    return input.prompt;
  }
  if (input.image_reference_mode === "edit") {
    return `Edit the provided image content directly. Preserve everything not explicitly changed. ${input.prompt}`;
  }
  return `Generate a new image using the provided images as visual references. ${input.prompt}`;
}

async function waitForImageInteraction(client: GoogleGenAI, id: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await delay(2_000);
    const interaction = await client.interactions.get(id);
    if (interaction.status === "completed") {
      return interaction;
    }
    if (["cancelled", "failed", "incomplete", "budget_exceeded"].includes(interaction.status)) {
      throw upstreamMediaError(`Image generation ended with status ${interaction.status}.`);
    }
  }
  throw upstreamMediaError("Image generation timed out.", true);
}

function extractInteractionImage(steps: unknown): MediaReference | null {
  const parsed = InteractionStepsSchema.safeParse(steps);
  if (!parsed.success) {
    return null;
  }
  for (const step of parsed.data) {
    if (step.type !== "model_output") {
      continue;
    }
    for (const content of step.content ?? []) {
      if (content.type === "image" && content.data && content.mime_type) {
        return { base64: content.data, mimeType: content.mime_type };
      }
    }
  }
  return null;
}

async function generateVideo(
  client: GoogleGenAI,
  apiKey: string,
  input: GenerateOrEditMediaInput,
  runtime: CodeRuntimeContext,
): Promise<GeneratedMedia> {
  const references = await loadReferences(input.reference_images ?? [], runtime);
  const video = input.reference_video
    ? await loadReference(input.reference_video, runtime, "video")
    : undefined;
  let operation = await client.models.generateVideos({
    config: videoConfig(input, references),
    model: VIDEO_MODEL,
    prompt: input.prompt,
    ...(video ? { video: referenceVideo(video) } : {}),
  });
  for (let attempt = 0; !operation.done && attempt < VIDEO_POLL_LIMIT; attempt += 1) {
    await delay(VIDEO_POLL_INTERVAL_MS);
    operation = await client.operations.getVideosOperation({ operation });
  }
  if (!operation.done || operation.error) {
    throw upstreamMediaError(
      operation.done ? "Video generation failed." : "Video generation timed out.",
      !operation.done,
    );
  }
  const generated = operation.response?.generatedVideos?.[0]?.video;
  if (!generated) {
    throw upstreamMediaError("Video generation completed without a video.");
  }
  const bytes = await videoBytes(generated, apiKey);
  return generatedMedia(bytesToBase64(bytes), generated.mimeType ?? "video/mp4", VIDEO_MODEL);
}

function videoConfig(input: GenerateOrEditMediaInput, references: MediaReference[]) {
  return {
    aspectRatio: input.aspect_ratio ?? "16:9",
    durationSeconds: input.duration ?? 8,
    generateAudio: true,
    numberOfVideos: 1,
    referenceImages: references.map((reference) => ({
      image: referenceImage(reference),
      referenceType: VideoGenerationReferenceType.ASSET,
    })),
    resolution: "1080p",
  };
}

function referenceImage(reference: MediaReference): Image {
  return { imageBytes: reference.base64, mimeType: reference.mimeType };
}

function referenceVideo(reference: MediaReference): Video {
  return { mimeType: reference.mimeType, videoBytes: reference.base64 };
}

async function videoBytes(video: Video, apiKey: string): Promise<Uint8Array> {
  if (video.videoBytes) {
    return base64ToBytes(video.videoBytes);
  }
  if (!video.uri) {
    throw upstreamMediaError("Generated video has no downloadable content.");
  }
  const response = await fetch(video.uri, { headers: { "x-goog-api-key": apiKey } });
  if (!response.ok) {
    throw upstreamMediaError(`Generated video download failed with HTTP ${response.status}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_VIDEO_BYTES) {
    throw upstreamMediaError("Generated video exceeded the supported artifact size.");
  }
  return bytes;
}

async function loadReferences(
  paths: string[],
  runtime: CodeRuntimeContext,
): Promise<MediaReference[]> {
  return Promise.all(paths.map((path) => loadReference(path, runtime, "image")));
}

async function loadReference(
  path: string,
  runtime: CodeRuntimeContext,
  expected: "image" | "video",
): Promise<MediaReference> {
  if (path.startsWith("https://")) {
    return loadRemoteReference(path, expected);
  }
  if (!runtime.sandbox.readFile) {
    throw new APIError(500, "internal_error", "Sandbox file reading is unavailable.");
  }
  const resolved = resolveSandboxPath(path, runtime.workspaceDir);
  const file = await runtime.sandbox.readFile({ encoding: "base64", path: resolved });
  const bytes = base64ByteLength(file.content);
  if (bytes === 0 || bytes > MAX_REFERENCE_BYTES) {
    throw invalidMediaReference("Reference media is empty or too large.");
  }
  return { base64: file.content, mimeType: mimeTypeForPath(resolved, expected) };
}

async function loadRemoteReference(
  url: string,
  expected: "image" | "video",
): Promise<MediaReference> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw invalidMediaReference(`Reference media returned HTTP ${response.status}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REFERENCE_BYTES) {
    throw invalidMediaReference("Reference media is empty or too large.");
  }
  const declared = response.headers.get("content-type")?.split(";")[0]?.trim();
  const mimeType = declared?.startsWith(`${expected}/`) ? declared : mimeTypeForPath(url, expected);
  return { base64: bytesToBase64(bytes), mimeType };
}

async function writeMediaToWorkspace(
  runtime: CodeRuntimeContext,
  type: "image" | "video",
  filename: string,
  bytes: Uint8Array,
): Promise<string> {
  const root = runtime.workspaceDir ?? "/workspace";
  const directory = `${root}/.cheatcode/assets/${type === "image" ? "images" : "videos"}`;
  const path = `${directory}/${filename}`;
  await runtime.sandbox.exec?.({ command: ["mkdir", "-p", directory], cwd: root });
  if (runtime.sandbox.writeFile) {
    await runtime.sandbox.writeFile({ content: bytesToBase64(bytes), encoding: "base64", path });
  }
  return path;
}

async function storeArtifact(
  runtime: CodeRuntimeContext,
  type: "image" | "video",
  filename: string,
  media: GeneratedMedia,
): Promise<ArtifactUploadResult> {
  if (!runtime.artifacts) {
    throw new APIError(500, "internal_error", "Artifact storage is unavailable.", {
      retriable: true,
    });
  }
  return runtime.artifacts.put({
    contentType: media.mimeType,
    data: media.bytes,
    filename,
    kind: type,
  });
}

function generatedMedia(base64: string, mimeType: string, model: string): GeneratedMedia {
  return {
    bytes: base64ToBytes(base64),
    extension: extensionForMimeType(mimeType),
    mimeType,
    model,
  };
}

function resolveSandboxPath(path: string, workspaceDir = "/workspace"): string {
  const candidate = path.startsWith("/") ? path : `${workspaceDir}/${path}`;
  const segments = candidate.split("/").filter(Boolean);
  if (segments.includes("..") || !candidate.startsWith("/workspace")) {
    throw invalidMediaReference("Reference media must stay inside /workspace.");
  }
  return candidate;
}

function generatedFilename(prompt: string, extension: string): string {
  const base = prompt
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${base || "generated-media"}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
}

function mimeTypeForPath(path: string, expected: "image" | "video"): string {
  const clean = path.split("?")[0]?.toLowerCase() ?? path.toLowerCase();
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".mp4")) return "video/mp4";
  if (clean.endsWith(".webm")) return "video/webm";
  if (clean.endsWith(".mov")) return "video/quicktime";
  return expected === "image" ? "image/png" : "video/mp4";
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/quicktime") return "mov";
  return mimeType.startsWith("video/") ? "mp4" : "png";
}

function requiredApiKey(value: string): string {
  const key = value.trim();
  if (!key) {
    throw new APIError(400, "byok_key_missing", "Add a Google API key to generate media.", {
      hint: "Open Models and configure your Google API key.",
      retriable: false,
    });
  }
  return key;
}

function invalidMediaReference(message: string): APIError {
  return new APIError(400, "tool_validation_failed", message, { retriable: false });
}

function upstreamMediaError(message: string, retriable = false): APIError {
  return new APIError(502, "upstream_provider_outage", message, { retriable });
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}

function base64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
