import { APIError } from "@cheatcode/observability";
import { z } from "zod/v4";
import { storeRemoteMediaArtifact } from "./artifacts";
import type { MediaRuntimeContext } from "./runtime";
import { requireMediaProviderKey } from "./runtime";
import {
  type FalImageEditInput,
  FalImageEditInputSchema,
  type FalImageInput,
  FalImageInputSchema,
  type FalMediaOutput,
  FalMediaOutputSchema,
  type FalVideoInput,
  FalVideoInputSchema,
} from "./schemas";

export interface FalClientLike {
  subscribe(endpointId: string, options: { input: Record<string, unknown> }): Promise<unknown>;
}

const FalProviderFileSchema = z
  .object({
    content_type: z.string().optional(),
    file_name: z.string().optional(),
    file_size: z.number().int().nonnegative().optional(),
    height: z.number().int().positive().optional(),
    url: z.string().url(),
    width: z.number().int().positive().optional(),
  })
  .passthrough();

const FalImageResponseSchema = z
  .object({
    data: z.unknown().optional(),
    has_nsfw_concepts: z.array(z.boolean()).optional(),
    images: z.array(FalProviderFileSchema).optional(),
    prompt: z.string().optional(),
    seed: z.number().optional(),
  })
  .passthrough();

const FalVideoResponseSchema = z
  .object({
    data: z.unknown().optional(),
    seed: z.number().optional(),
    video: FalProviderFileSchema.optional(),
  })
  .passthrough();

export async function executeFalImage(
  input: unknown,
  runtimeContext: MediaRuntimeContext,
  client?: FalClientLike,
): Promise<FalMediaOutput> {
  const resolvedClient = client ?? (await createScopedFalClient(runtimeContext));
  const parsedInput = FalImageInputSchema.parse(input);
  const response = FalImageResponseSchema.parse(
    unwrapFalData(
      await resolvedClient.subscribe(parsedInput.modelId, { input: falImagePayload(parsedInput) }),
    ),
  );
  const artifact = await storeFalImageArtifact({
    fallbackFilename: parsedInput.filename ?? "fal-image.png",
    fallbackMimeType: `image/${parsedInput.outputFormat}`,
    modelId: parsedInput.modelId,
    prompt: parsedInput.prompt,
    response,
    runtimeContext,
  });
  return FalMediaOutputSchema.parse({
    ...artifact,
    kind: "image",
    modelId: parsedInput.modelId,
    prompt: parsedInput.prompt,
    provider: "fal",
    seed: response.seed,
  });
}

export async function executeFalImageEdit(
  input: unknown,
  runtimeContext: MediaRuntimeContext,
  client?: FalClientLike,
): Promise<FalMediaOutput> {
  const resolvedClient = client ?? (await createScopedFalClient(runtimeContext));
  const parsedInput = FalImageEditInputSchema.parse(input);
  const response = FalImageResponseSchema.parse(
    unwrapFalData(
      await resolvedClient.subscribe(parsedInput.modelId, {
        input: falImageEditPayload(parsedInput),
      }),
    ),
  );
  const artifact = await storeFalImageArtifact({
    fallbackFilename: parsedInput.filename ?? "fal-image-edit.png",
    fallbackMimeType: `image/${parsedInput.outputFormat}`,
    modelId: parsedInput.modelId,
    prompt: parsedInput.prompt,
    response,
    runtimeContext,
  });
  return FalMediaOutputSchema.parse({
    ...artifact,
    kind: "image",
    modelId: parsedInput.modelId,
    prompt: parsedInput.prompt,
    provider: "fal",
    seed: response.seed,
  });
}

export async function executeFalVideo(
  input: unknown,
  runtimeContext: MediaRuntimeContext,
  client?: FalClientLike,
): Promise<FalMediaOutput> {
  const resolvedClient = client ?? (await createScopedFalClient(runtimeContext));
  const parsedInput = FalVideoInputSchema.parse(input);
  const response = FalVideoResponseSchema.parse(
    unwrapFalData(
      await resolvedClient.subscribe(parsedInput.modelId, { input: falVideoPayload(parsedInput) }),
    ),
  );
  if (!response.video) {
    throw new APIError(502, "upstream_provider_outage", "FAL video generation returned no video", {
      retriable: true,
    });
  }
  const artifact = await storeRemoteMediaArtifact({
    fallbackFilename: parsedInput.filename ?? "fal-video.mp4",
    fallbackMimeType: response.video.content_type ?? "video/mp4",
    file: normalizeFalFile(response.video),
    kind: "video",
    metadata: {
      modelId: parsedInput.modelId,
      prompt: parsedInput.prompt,
      provider: "fal",
      seed: response.seed,
    },
    runtimeContext,
  });
  return FalMediaOutputSchema.parse({
    ...artifact,
    kind: "video",
    modelId: parsedInput.modelId,
    prompt: parsedInput.prompt,
    provider: "fal",
    seed: response.seed,
  });
}

// Dynamically imported so the FAL SDK stays out of the agent-worker isolate's
// startup path (CF startup CPU limit). Only loaded when an image/video tool fires.
async function createScopedFalClient(runtimeContext: MediaRuntimeContext): Promise<FalClientLike> {
  const { createFalClient } = await import("@fal-ai/client");
  return createFalClient({
    credentials: requireMediaProviderKey(runtimeContext, "fal"),
  });
}

function falImagePayload(input: FalImageInput): Record<string, unknown> {
  return stripUndefined({
    ...input.additionalInput,
    enable_prompt_expansion: input.enablePromptExpansion,
    enable_safety_checker: input.enableSafetyChecker,
    guidance_scale: input.guidanceScale,
    image_size: input.imageSize,
    num_images: input.numImages,
    output_format: input.outputFormat,
    prompt: input.prompt,
    seed: input.seed,
  });
}

function falVideoPayload(input: FalVideoInput): Record<string, unknown> {
  return stripUndefined({
    ...input.additionalInput,
    aspect_ratio: input.aspectRatio,
    auto_fix: input.autoFix,
    duration: input.duration,
    generate_audio: input.generateAudio,
    negative_prompt: input.negativePrompt,
    prompt: input.prompt,
    resolution: input.resolution,
    safety_tolerance: input.safetyTolerance,
    seed: input.seed,
  });
}

function falImageEditPayload(input: FalImageEditInput): Record<string, unknown> {
  return stripUndefined({
    ...input.additionalInput,
    aspect_ratio: input.aspectRatio,
    enable_web_search: input.enableWebSearch,
    image_urls: input.imageUrls,
    limit_generations: input.limitGenerations,
    num_images: input.numImages,
    output_format: input.outputFormat,
    prompt: input.prompt,
    resolution: input.resolution,
    safety_tolerance: input.safetyTolerance,
    seed: input.seed,
    system_prompt: input.systemPrompt,
  });
}

async function storeFalImageArtifact(input: {
  fallbackFilename: string;
  fallbackMimeType: string;
  modelId: string;
  prompt: string;
  response: z.infer<typeof FalImageResponseSchema>;
  runtimeContext: MediaRuntimeContext;
}) {
  const file = input.response.images?.[0];
  if (!file) {
    throw new APIError(502, "upstream_provider_outage", "FAL image generation returned no image", {
      retriable: true,
    });
  }
  return storeRemoteMediaArtifact({
    fallbackFilename: input.fallbackFilename,
    fallbackMimeType: file.content_type ?? input.fallbackMimeType,
    file: normalizeFalFile(file),
    kind: "image",
    metadata: {
      modelId: input.modelId,
      prompt: input.prompt,
      provider: "fal",
      seed: input.response.seed,
    },
    runtimeContext: input.runtimeContext,
  });
}

function unwrapFalData(response: unknown): unknown {
  const record = asRecord(response);
  return record["data"] ?? response;
}

function normalizeFalFile(file: z.infer<typeof FalProviderFileSchema>) {
  return {
    contentType: file.content_type,
    fileName: file.file_name,
    fileSize: file.file_size,
    url: file.url,
  };
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
