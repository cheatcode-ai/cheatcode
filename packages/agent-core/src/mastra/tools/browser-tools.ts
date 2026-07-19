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
} from "@cheatcode/tools-browser";
import { createTool } from "@mastra/core/tools";
import { browserRuntimeFromContext } from "./tool-runtime-context";

export const mastraBrowserOpen = createTool({
  id: "browser_open",
  description:
    "Open a URL in the sandbox's local headed Chromium browser through Stagehand LOCAL mode.",
  inputSchema: BrowserOpenInputSchema,
  outputSchema: BrowserActionsOutputSchema,
  execute: async (input, context) =>
    executeBrowserOpen(input, await browserRuntimeFromContext(context)),
});

export const mastraBrowserAct = createTool({
  id: "browser_act",
  description:
    "Perform a natural-language browser action in the sandbox's local headed Chromium browser.",
  inputSchema: BrowserActInputSchema,
  outputSchema: BrowserActionsOutputSchema,
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
    "Observe available UI elements or page state in the sandbox's local headed Chromium browser.",
  inputSchema: BrowserObserveInputSchema,
  outputSchema: BrowserActionsOutputSchema,
  execute: async (input, context) =>
    executeBrowserObserve(input, await browserRuntimeFromContext(context)),
});

export const mastraBrowserExtract = createTool({
  id: "browser_extract",
  description:
    "Extract structured information from the current sandbox browser page with Stagehand LOCAL mode.",
  inputSchema: BrowserExtractInputSchema,
  outputSchema: BrowserActionsOutputSchema,
  execute: async (input, context) =>
    executeBrowserExtract(input, await browserRuntimeFromContext(context)),
});

export const mastraBrowserScreenshot = createTool({
  id: "browser_screenshot",
  description:
    "Capture the current sandbox browser page as a PNG artifact. The result contains bounded artifact metadata and a download URL, never inline base64 image data.",
  inputSchema: BrowserScreenshotInputSchema,
  outputSchema: BrowserActionsOutputSchema,
  execute: async (input, context) =>
    executeBrowserScreenshot(input, await browserRuntimeFromContext(context)),
});
