import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { APIError } from "@cheatcode/observability";
import { generateText, type LanguageModel } from "ai";
import { boundedProviderFetch } from "../../provider-fetch-support";
import type { BrowserRuntimeContext } from "./runtime";

const INSPECTION_TIMEOUT_MS = 30_000;
const MAX_ASSESSMENT_CHARACTERS = 4_000;
const INSPECTION_SYSTEM_PROMPT = `Inspect the supplied browser screenshot against the requested visual check.
Return exactly one concise paragraph starting with PASS or FAIL.
Report only visible evidence. Name concrete layout, clipping, readability, missing-content, or error-state defects.
Do not infer console state, network state, hidden behavior, or interaction behavior from pixels.`;

/** Converts transient screenshot bytes into bounded model-visible evidence before workflow persistence. */
export async function inspectBrowserScreenshot(
  screenshot: Uint8Array,
  instruction: string,
  credential: BrowserRuntimeContext["credential"],
): Promise<string> {
  try {
    const result = await generateText({
      abortSignal: AbortSignal.timeout(INSPECTION_TIMEOUT_MS),
      maxOutputTokens: 500,
      maxRetries: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: instruction },
            { type: "file", data: screenshot, mediaType: "image/png" },
          ],
        },
      ],
      model: browserVisionModel(credential),
      system: INSPECTION_SYSTEM_PROMPT,
    });
    return requireBoundedAssessment(result.text);
  } catch (error) {
    throw new APIError(502, "tool_execution_failed", "Browser screenshot inspection failed", {
      cause: error,
      hint: "Use the browser's structured page observation instead of repeating the screenshot.",
      retriable: false,
    });
  }
}

function browserVisionModel(credential: BrowserRuntimeContext["credential"]): LanguageModel {
  const options = { apiKey: credential.apiKey, fetch: boundedProviderFetch };
  if (credential.provider === "anthropic") {
    return createAnthropic(options)(credential.modelId);
  }
  if (credential.provider === "google") {
    return createGoogle(options)(credential.modelId);
  }
  return createOpenAI(options).responses(credential.modelId);
}

function requireBoundedAssessment(value: string): string {
  const assessment = value.trim();
  if (!assessment || assessment.length > MAX_ASSESSMENT_CHARACTERS) {
    throw new Error("Browser screenshot assessment is empty or too large");
  }
  return assessment;
}
