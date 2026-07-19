const PROMPT_HANDOFF_PREFIX = "cheatcode:bootstrap-prompt:";
const MAX_CONSUMED_PROMPTS = 32;
const consumedPrompts = new Map<string, null | string>();

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
  if (consumedPrompts.has(promptKey)) {
    return consumedPrompts.get(promptKey) ?? null;
  }
  if (!canUseSessionStorage()) {
    return null;
  }
  const storageKey = `${PROMPT_HANDOFF_PREFIX}${promptKey}`;
  try {
    const prompt = sessionStorage.getItem(storageKey);
    sessionStorage.removeItem(storageKey);
    rememberConsumedPrompt(promptKey, prompt);
    return prompt;
  } catch {
    return null;
  }
}

function rememberConsumedPrompt(promptKey: string, prompt: null | string): void {
  consumedPrompts.set(promptKey, prompt);
  if (consumedPrompts.size <= MAX_CONSUMED_PROMPTS) {
    return;
  }
  const oldestKey = consumedPrompts.keys().next().value;
  if (oldestKey) {
    consumedPrompts.delete(oldestKey);
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
