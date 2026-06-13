import { z } from "zod/v4";

export const MediaArtifactKindSchema = z.enum(["audio", "image", "video"]);

export const MediaArtifactOutputSchema = z
  .object({
    downloadUrl: z.string().url(),
    filename: z.string().min(1),
    kind: MediaArtifactKindSchema,
    mimeType: z.string().min(1),
    outputId: z.string().min(1),
    providerUrl: z.string().url().optional(),
    r2Key: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

const ImageSizeSchema = z.union([
  z.enum([
    "square_hd",
    "square",
    "portrait_4_3",
    "portrait_16_9",
    "landscape_4_3",
    "landscape_16_9",
  ]),
  z
    .object({
      height: z.number().int().min(512).max(2048),
      width: z.number().int().min(512).max(2048),
    })
    .strict(),
]);

export const FalImageInputSchema = z
  .object({
    additionalInput: z.record(z.string(), z.unknown()).default({}),
    enablePromptExpansion: z.boolean().default(false),
    enableSafetyChecker: z.boolean().default(true),
    filename: z.string().trim().min(1).max(160).optional(),
    guidanceScale: z.number().min(0).max(20).default(2.5),
    imageSize: ImageSizeSchema.default("landscape_4_3"),
    modelId: z.string().trim().min(1).max(200).default("fal-ai/flux-2/turbo"),
    numImages: z.number().int().min(1).max(4).default(1),
    outputFormat: z.enum(["jpeg", "png"]).default("png"),
    prompt: z.string().trim().min(1).max(4_000),
    seed: z.number().int().optional(),
  })
  .strict();

export const FalImageEditInputSchema = z
  .object({
    additionalInput: z.record(z.string(), z.unknown()).default({}),
    aspectRatio: z
      .enum(["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"])
      .default("auto"),
    enableWebSearch: z.boolean().default(false),
    filename: z.string().trim().min(1).max(160).optional(),
    imageUrls: z.array(z.string().url()).min(1).max(8),
    limitGenerations: z.boolean().default(false),
    modelId: z.string().trim().min(1).max(200).default("fal-ai/gemini-3-pro-image-preview/edit"),
    numImages: z.number().int().min(1).max(4).default(1),
    outputFormat: z.enum(["jpeg", "png", "webp"]).default("png"),
    prompt: z.string().trim().min(1).max(4_000),
    resolution: z.enum(["1K", "2K", "4K"]).default("1K"),
    safetyTolerance: z.enum(["1", "2", "3", "4", "5", "6"]).default("4"),
    seed: z.number().int().optional(),
    systemPrompt: z.string().trim().max(2_000).default(""),
  })
  .strict();

export const FalVideoInputSchema = z
  .object({
    additionalInput: z.record(z.string(), z.unknown()).default({}),
    aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
    autoFix: z.boolean().default(true),
    duration: z.enum(["4s", "6s", "8s"]).default("8s"),
    filename: z.string().trim().min(1).max(160).optional(),
    generateAudio: z.boolean().default(true),
    modelId: z.string().trim().min(1).max(200).default("fal-ai/veo3.1"),
    negativePrompt: z.string().trim().min(1).max(2_000).optional(),
    prompt: z.string().trim().min(1).max(4_000),
    resolution: z.enum(["720p", "1080p", "4k"]).default("720p"),
    safetyTolerance: z.enum(["1", "2", "3", "4", "5", "6"]).default("4"),
    seed: z.number().int().optional(),
  })
  .strict();

export const FalMediaOutputSchema = MediaArtifactOutputSchema.extend({
  modelId: z.string(),
  prompt: z.string(),
  provider: z.literal("fal"),
  seed: z.number().optional(),
}).strict();

export const ElevenLabsTtsInputSchema = z
  .object({
    filename: z.string().trim().min(1).max(160).optional(),
    modelId: z.string().trim().min(1).max(120).default("eleven_v3"),
    outputFormat: z
      .enum(["mp3_44100_128", "mp3_44100_192", "mp3_22050_32", "pcm_16000", "ulaw_8000"])
      .default("mp3_44100_128"),
    text: z.string().trim().min(1).max(5_000),
    voiceId: z.string().trim().min(1).max(120).default("JBFqnCBsd6RMkjVDRZzb"),
  })
  .strict();

export const ElevenLabsTtsOutputSchema = MediaArtifactOutputSchema.extend({
  modelId: z.string(),
  provider: z.literal("elevenlabs"),
  voiceId: z.string(),
}).strict();

export const ElevenLabsTranscriptionInputSchema = z
  .object({
    audioBase64: z.string().trim().min(1).optional(),
    audioUrl: z.string().url().optional(),
    filename: z.string().trim().min(1).max(160).default("audio.mp3"),
    languageCode: z.string().trim().min(2).max(16).optional(),
    mimeType: z.string().trim().min(1).max(120).default("audio/mpeg"),
    modelId: z.enum(["scribe_v2", "scribe_v1"]).default("scribe_v2"),
  })
  .strict()
  .refine((input) => Boolean(input.audioBase64) !== Boolean(input.audioUrl), {
    message: "Provide exactly one of audioBase64 or audioUrl.",
    path: ["audioUrl"],
  });

export const ElevenLabsTranscriptionOutputSchema = z
  .object({
    languageCode: z.string().optional(),
    modelId: z.string(),
    provider: z.literal("elevenlabs"),
    text: z.string(),
  })
  .strict();

export type ElevenLabsTranscriptionInput = z.infer<typeof ElevenLabsTranscriptionInputSchema>;
export type ElevenLabsTranscriptionOutput = z.infer<typeof ElevenLabsTranscriptionOutputSchema>;
export type ElevenLabsTtsInput = z.infer<typeof ElevenLabsTtsInputSchema>;
export type ElevenLabsTtsOutput = z.infer<typeof ElevenLabsTtsOutputSchema>;
export type FalImageEditInput = z.infer<typeof FalImageEditInputSchema>;
export type FalImageInput = z.infer<typeof FalImageInputSchema>;
export type FalMediaOutput = z.infer<typeof FalMediaOutputSchema>;
export type FalVideoInput = z.infer<typeof FalVideoInputSchema>;
export type MediaArtifactOutput = z.infer<typeof MediaArtifactOutputSchema>;
