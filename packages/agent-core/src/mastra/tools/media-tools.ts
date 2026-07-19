import {
  executeGenerateOrEditMedia,
  GenerateOrEditMediaInputSchema,
  GenerateOrEditMediaOutputSchema,
} from "@cheatcode/tools-media";
import { createTool } from "@mastra/core/tools";
import { GOOGLE_API_KEY_CONTEXT_KEY } from "../llm-context";
import { requestContextFromToolContext, workspaceRuntimeFromContext } from "./tool-runtime-context";

/** Generates or edits image/video artifacts with the user's request-scoped Google key. */
export const mastraGenerateOrEditMedia = createTool({
  id: "generate_or_edit_media",
  description:
    "Generate or edit an image, or generate/extend a video, using Google media models. Stores the result in the project and Deliverables.",
  inputSchema: GenerateOrEditMediaInputSchema,
  outputSchema: GenerateOrEditMediaOutputSchema,
  execute: async (input, context) => {
    const requestContext = requestContextFromToolContext(context);
    const googleApiKey = requestContext.get(GOOGLE_API_KEY_CONTEXT_KEY);
    return executeGenerateOrEditMedia(
      GenerateOrEditMediaInputSchema.parse(input),
      await workspaceRuntimeFromContext(context),
      typeof googleApiKey === "string" ? googleApiKey : "",
    );
  },
});
