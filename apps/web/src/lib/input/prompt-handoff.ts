const PROMPT_HANDOFF_PREFIX = "cheatcode:bootstrap-prompt:";

export interface PromptHandoff {
  promptKey: string;
}

export function createPromptHandoff(prompt: string): PromptHandoff {
  if (!canUseSessionStorage()) {
    throw new Error("This browser cannot securely hand off the prompt. Enable session storage.");
  }
  const promptKey = createPromptKey();
  try {
    sessionStorage.setItem(`${PROMPT_HANDOFF_PREFIX}${promptKey}`, prompt);
  } catch {
    throw new Error("This browser could not securely store the prompt for navigation.");
  }
  return { promptKey };
}

export function consumePromptHandoff(promptKey: string): string | null {
  if (!canUseSessionStorage()) {
    return null;
  }
  const storageKey = `${PROMPT_HANDOFF_PREFIX}${promptKey}`;
  try {
    const prompt = sessionStorage.getItem(storageKey);
    sessionStorage.removeItem(storageKey);
    return prompt;
  } catch {
    return null;
  }
}

function canUseSessionStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

function createPromptKey(): string {
  return crypto.randomUUID();
}
