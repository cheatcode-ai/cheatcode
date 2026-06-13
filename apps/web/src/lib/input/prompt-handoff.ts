const DIRECT_PROMPT_MAX_LENGTH = 1_800;
const PROMPT_HANDOFF_PREFIX = "cheatcode:bootstrap-prompt:";

export interface PromptHandoff {
  prompt?: string;
  promptKey?: string;
}

export function createPromptHandoff(prompt: string): PromptHandoff {
  if (prompt.length <= DIRECT_PROMPT_MAX_LENGTH || !canUseSessionStorage()) {
    return { prompt };
  }
  const promptKey = createPromptKey();
  sessionStorage.setItem(`${PROMPT_HANDOFF_PREFIX}${promptKey}`, prompt);
  return { promptKey };
}

export function consumePromptHandoff(promptKey: string): string | null {
  if (!canUseSessionStorage()) {
    return null;
  }
  const storageKey = `${PROMPT_HANDOFF_PREFIX}${promptKey}`;
  const prompt = sessionStorage.getItem(storageKey);
  sessionStorage.removeItem(storageKey);
  return prompt;
}

function canUseSessionStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

function createPromptKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `prompt-${Date.now().toString(36)}`;
}
