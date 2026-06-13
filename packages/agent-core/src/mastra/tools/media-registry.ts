import { CodeRuntimeContextSchema } from "@cheatcode/tools-code";
import {
  ElevenLabsTranscriptionInputSchema,
  ElevenLabsTranscriptionOutputSchema,
  ElevenLabsTtsInputSchema,
  ElevenLabsTtsOutputSchema,
  executeElevenLabsTranscription,
  executeElevenLabsTts,
  executeFalImage,
  executeFalImageEdit,
  executeFalVideo,
  FalImageEditInputSchema,
  FalImageInputSchema,
  FalMediaOutputSchema,
  FalVideoInputSchema,
  MediaRuntimeContextSchema,
} from "@cheatcode/tools-media";
import { createTool } from "@mastra/core/tools";
import { ELEVENLABS_API_KEY_CONTEXT_KEY, FAL_API_KEY_CONTEXT_KEY } from "../media-context";

const requestContextReaderSchema = {
  parse(value: unknown): { get(key: string): unknown } {
    if (!value || typeof value !== "object") {
      throw new Error("Mastra request context is required for media tools.");
    }
    const candidate = value as { get?: unknown };
    if (typeof candidate.get !== "function") {
      throw new Error("Mastra request context does not expose get().");
    }
    return candidate as { get(key: string): unknown };
  },
};

function mediaRuntimeFromContext(context: unknown) {
  const requestContext = requestContextReaderSchema.parse(
    typeof context === "object" && context !== null
      ? (context as { requestContext?: unknown }).requestContext
      : undefined,
  );
  const codeRuntime = CodeRuntimeContextSchema.parse(requestContext.get("codeRuntime"));
  return MediaRuntimeContextSchema.parse({
    artifacts: codeRuntime.artifacts,
    elevenlabsApiKey: requestContext.get(ELEVENLABS_API_KEY_CONTEXT_KEY),
    falApiKey: requestContext.get(FAL_API_KEY_CONTEXT_KEY),
  });
}

export const mastraMediaGenerateImage = createTool({
  id: "media_generate_image",
  description: "Generate an image with FAL FLUX.2 and return a Worker-signed R2 download URL.",
  inputSchema: FalImageInputSchema,
  outputSchema: FalMediaOutputSchema,
  execute: async (input, context) => executeFalImage(input, mediaRuntimeFromContext(context)),
});

export const mastraMediaGenerateVideo = createTool({
  id: "media_generate_video",
  description: "Generate a video with FAL Veo 3.1 and return a Worker-signed R2 download URL.",
  inputSchema: FalVideoInputSchema,
  outputSchema: FalMediaOutputSchema,
  execute: async (input, context) => executeFalVideo(input, mediaRuntimeFromContext(context)),
});

export const mastraMediaEditImage = createTool({
  id: "media_edit_image",
  description:
    "Edit an existing image with FAL Gemini 3 Pro Image and return a Worker-signed R2 download URL.",
  inputSchema: FalImageEditInputSchema,
  outputSchema: FalMediaOutputSchema,
  execute: async (input, context) => executeFalImageEdit(input, mediaRuntimeFromContext(context)),
});

export const mastraMediaGenerateSpeech = createTool({
  id: "media_generate_speech",
  description:
    "Generate speech audio with ElevenLabs v3 and return a Worker-signed R2 download URL.",
  inputSchema: ElevenLabsTtsInputSchema,
  outputSchema: ElevenLabsTtsOutputSchema,
  execute: async (input, context) => executeElevenLabsTts(input, mediaRuntimeFromContext(context)),
});

export const mastraMediaTranscribe = createTool({
  id: "media_transcribe",
  description: "Transcribe audio with ElevenLabs Scribe v2 from an audio URL or base64 payload.",
  inputSchema: ElevenLabsTranscriptionInputSchema,
  outputSchema: ElevenLabsTranscriptionOutputSchema,
  execute: async (input, context) =>
    executeElevenLabsTranscription(input, mediaRuntimeFromContext(context)),
});

export const mastraMediaTools = {
  media_edit_image: mastraMediaEditImage,
  media_generate_image: mastraMediaGenerateImage,
  media_generate_speech: mastraMediaGenerateSpeech,
  media_generate_video: mastraMediaGenerateVideo,
  media_transcribe: mastraMediaTranscribe,
} as const;
