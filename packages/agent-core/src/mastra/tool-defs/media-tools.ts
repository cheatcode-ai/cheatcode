import { createTool } from "@mastra/core/tools";
import { executeGenerateOrEditMedia } from "../../tools/media/execute";
import {
  GenerateOrEditMediaInputSchema,
  GenerateOrEditMediaOutputSchema,
} from "../../tools/media/schemas";
import { resolveGoogleToolApiKey } from "./request-context";
import { requestContextFromToolContext, workspaceRuntimeFromContext } from "./tool-runtime-context";

/** Generates or edits media after lazily resolving the user's Google AI tool key. */
export const mastraGenerateOrEditMedia = createTool({
  id: "generate_or_edit_media",
  description:
    "Generate or edit an image, or generate/extend a video, using Google media models. Stores the result in the project and Deliverables.",
  inputSchema: GenerateOrEditMediaInputSchema,
  outputSchema: GenerateOrEditMediaOutputSchema,
  execute: async (input, context) => {
    const requestContext = requestContextFromToolContext(context);
    const googleApiKey = await resolveGoogleToolApiKey(requestContext);
    return executeGenerateOrEditMedia(
      GenerateOrEditMediaInputSchema.parse(input),
      await workspaceRuntimeFromContext(context),
      googleApiKey ?? "",
    );
  },
});
