import { createTool } from "@mastra/core/tools";
import {
  executeGenerateOrEditImage,
  executeGenerateOrExtendVideo,
} from "../../tools/media/execute";
import {
  GenerateImageOutputSchema,
  GenerateOrEditImageInputSchema,
  GenerateOrExtendVideoInputSchema,
  GenerateVideoOutputSchema,
} from "../../tools/media/schemas";
import { resolveGoogleToolApiKey } from "./request-context";
import { requestContextFromToolContext, workspaceRuntimeFromContext } from "./tool-runtime-context";

/** Generates or edits one image through a contract that cannot accept video-only fields. */
export const mastraGenerateOrEditImage = createTool({
  id: "generate_or_edit_image",
  description:
    "Generate a new image or edit/reference provided images with Google AI. Publishes the result to the project and Deliverables in one bounded call.",
  inputSchema: GenerateOrEditImageInputSchema,
  outputSchema: GenerateImageOutputSchema,
  execute: async (input, context) => {
    const requestContext = requestContextFromToolContext(context);
    const googleApiKey = await resolveGoogleToolApiKey(requestContext);
    return executeGenerateOrEditImage(
      GenerateOrEditImageInputSchema.parse(input),
      await workspaceRuntimeFromContext(context),
      googleApiKey ?? "",
    );
  },
});

/** Generates or extends one video through a contract that cannot accept image-edit fields. */
export const mastraGenerateOrExtendVideo = createTool({
  id: "generate_or_extend_video",
  description:
    "Generate a new video or extend a provided video with Google AI. Publishes the result to the project and Deliverables in one bounded call.",
  inputSchema: GenerateOrExtendVideoInputSchema,
  outputSchema: GenerateVideoOutputSchema,
  execute: async (input, context) => {
    const requestContext = requestContextFromToolContext(context);
    const googleApiKey = await resolveGoogleToolApiKey(requestContext);
    return executeGenerateOrExtendVideo(
      GenerateOrExtendVideoInputSchema.parse(input),
      await workspaceRuntimeFromContext(context),
      googleApiKey ?? "",
    );
  },
});
