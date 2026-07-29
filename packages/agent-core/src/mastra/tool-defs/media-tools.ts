import { createTool } from "@mastra/core/tools";
import { executeGenerateOrEditMedia } from "../../tools/media/execute";
import {
  GenerateOrEditMediaInputSchema,
  GenerateOrEditMediaOutputSchema,
} from "../../tools/media/schemas";
import { CONTEXT } from "../context";
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
    const googleApiKey = requestContext.get(CONTEXT.googleApiKey);
    return executeGenerateOrEditMedia(
      GenerateOrEditMediaInputSchema.parse(input),
      await workspaceRuntimeFromContext(context),
      typeof googleApiKey === "string" ? googleApiKey : "",
    );
  },
});
