import { buildSystemPromptSection } from "@cheatcode/skills";

export const MASTER_INSTRUCTIONS_CONTEXT_KEY = "masterInstructions";
export const AGENT_DISPLAY_NAME_CONTEXT_KEY = "agentDisplayName";
export const GLOBAL_MEMORY_CONTEXT_KEY = "globalMemory";

interface RequestContextReader {
  get(key: string): unknown;
}

export interface PromptRuntimeContext {
  agentDisplayName?: string;
  globalMemory?: string;
  masterInstructions?: string;
}

export function promptRuntimeContextFromRequestContext(
  requestContext: RequestContextReader | undefined,
): PromptRuntimeContext {
  const context: PromptRuntimeContext = {};
  const agentDisplayName = trimmedContextValue(requestContext, AGENT_DISPLAY_NAME_CONTEXT_KEY);
  if (agentDisplayName) {
    context.agentDisplayName = agentDisplayName;
  }
  const globalMemory = trimmedContextValue(requestContext, GLOBAL_MEMORY_CONTEXT_KEY);
  if (globalMemory) {
    context.globalMemory = globalMemory;
  }
  const masterInstructions = trimmedContextValue(requestContext, MASTER_INSTRUCTIONS_CONTEXT_KEY);
  if (masterInstructions) {
    context.masterInstructions = masterInstructions;
  }
  return context;
}

function trimmedContextValue(
  requestContext: RequestContextReader | undefined,
  key: string,
): string | undefined {
  const value = requestContext?.get(key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function buildSystemPrompt(runtimeContext: PromptRuntimeContext = {}): string {
  return [
    "You are Cheatcode, a generalist AI agent that builds apps, documents, research, and workflows.",
    runtimeContext.agentDisplayName
      ? `The user calls you "${runtimeContext.agentDisplayName}"; answer to that name.`
      : "",
    "Follow the user's instructions, respect BYOK constraints, and use tools for deterministic work.",
    "For coding and data requests, use the project sandbox tools instead of guessing. Use runCode for small scripts, shell_exec for CLI work, fs_read/fs_write/fs_list/fs_search for files, git_* for repositories, and start_dev_server for live previews on port 5173.",
    "For browser tasks, use browser_open, browser_act, browser_observe, browser_extract, and browser_screenshot. These run Stagehand LOCAL mode inside the sandbox browser; never ask for Browserbase or expose CDP.",
    "For document artifacts, use docs_generate_slides, docs_generate_docx, docs_generate_xlsx, or docs_generate_pdf. For generated media, use media_generate_image, media_edit_image, media_generate_video, media_generate_speech, or media_transcribe and return the signed download URL.",
    "For user-requested external app actions, use composio_list_tools to find exact action slugs and composio_execute only against integrations the user has connected in Settings.",
    "When building a web app preview, create or update files under /workspace, start the dev server with --hostname 0.0.0.0, and include the preview URL returned by start_dev_server.",
    runtimeContext.globalMemory
      ? `## User Memory\n${runtimeContext.globalMemory}\n\nProject instructions take precedence over this memory when they conflict.`
      : "",
    runtimeContext.masterInstructions
      ? `## Project Instructions\n${runtimeContext.masterInstructions}`
      : "",
    buildSystemPromptSection(),
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}
