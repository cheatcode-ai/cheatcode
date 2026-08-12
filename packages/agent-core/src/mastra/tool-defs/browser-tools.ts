import { createTool } from "@mastra/core/tools";
import {
  BrowserActInputSchema,
  BrowserActionsOutputSchema,
  BrowserExtractInputSchema,
  BrowserObserveInputSchema,
  BrowserOpenInputSchema,
  BrowserScreenshotInputSchema,
  executeBrowserAct,
  executeBrowserExtract,
  executeBrowserObserve,
  executeBrowserOpen,
  executeBrowserScreenshot,
  inspectBrowserPage,
} from "../../tools/browser";
import { browserRuntimeFromContext } from "./tool-runtime-context";

export const mastraBrowserOpen = createTool({
  id: "browser_open",
  description:
    "Open a URL in the sandbox's local headed Chromium browser through Stagehand LOCAL mode.",
  inputSchema: BrowserOpenInputSchema,
  outputSchema: BrowserActionsOutputSchema,
  strict: true,
  execute: async (input, context) =>
    executeBrowserOpen(input, await browserRuntimeFromContext(context)),
});

export const mastraBrowserAct = createTool({
  id: "browser_act",
  description:
    "Execute one deterministic action against an exact element ref from the latest browser_observe or browser_act tree. Provide method and ref, plus value only for a value-taking method or targetRef only for dragAndDrop. The consumed ref is page-bound and single-use; the result includes an actionable post-action page tree for the next step.",
  inputSchema: BrowserActInputSchema,
  inputExamples: [
    {
      input: {
        method: "click",
        ref: "1-2",
      },
    },
    {
      input: {
        method: "fill",
        ref: "1-3",
        value: "Ada Lovelace",
      },
    },
  ],
  outputSchema: BrowserActionsOutputSchema,
  strict: true,
  execute: async (input, context) => {
    const parsedInput = BrowserActInputSchema.parse(input);
    const runtimeContext = await browserRuntimeFromContext(context);
    const page = await inspectBrowserPage(runtimeContext);
    const expectedUrl = new URL(page.url);
    if (expectedUrl.username || expectedUrl.password) {
      throw new Error("Browser action URL must not contain embedded credentials.");
    }
    return executeBrowserAct(parsedInput, runtimeContext, {
      allowedOrigin: expectedUrl.origin,
      expectedUrl: page.url,
    });
  },
});

export const mastraBrowserObserve = createTool({
  id: "browser_observe",
  description:
    "Read the current sandbox page as a deterministic accessibility tree with page-bound element refs. Choose an exact hyphenated ref from the tree for browser_act; no secondary model is invoked.",
  inputSchema: BrowserObserveInputSchema,
  outputSchema: BrowserActionsOutputSchema,
  strict: true,
  execute: async (input, context) =>
    executeBrowserObserve(input, await browserRuntimeFromContext(context)),
});

export const mastraBrowserExtract = createTool({
  id: "browser_extract",
  description:
    "Extract structured information from the current sandbox browser page with Stagehand LOCAL mode.",
  inputSchema: BrowserExtractInputSchema,
  outputSchema: BrowserActionsOutputSchema,
  strict: true,
  execute: async (input, context) =>
    executeBrowserExtract(input, await browserRuntimeFromContext(context)),
});

export const mastraBrowserScreenshot = createTool({
  id: "browser_screenshot",
  description:
    "Capture and visually assess the current sandbox browser page against one explicit acceptance criterion. The image appears inside the expanded browser action as internal evidence, never as a user deliverable.",
  inputSchema: BrowserScreenshotInputSchema,
  outputSchema: BrowserActionsOutputSchema,
  strict: true,
  execute: async (input, context) =>
    executeBrowserScreenshot(input, await browserRuntimeFromContext(context)),
});
