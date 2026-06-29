import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { createLogger } from "@cheatcode/observability";
import { Composio } from "@composio/core";

export interface AutomationTriggerEnv {
  COMPOSIO_API_KEY?: WorkerSecret;
}

async function resolveApiKey(env: AutomationTriggerEnv): Promise<string | null> {
  try {
    return (await resolveWorkerSecret(env.COMPOSIO_API_KEY)) || null;
  } catch {
    return null;
  }
}

function client(apiKey: string): Composio {
  return new Composio({ allowTracking: false, apiKey, baseURL: "https://backend.composio.dev" });
}

/** Register + enable a Composio trigger for a user. Returns the stable triggerId to
 * persist, or null on failure (fail-soft — the automation is still created, just inert
 * until a trigger is wired). `triggerSlug` is the Composio trigger type (e.g. GMAIL_NEW_GMAIL_MESSAGE). */
export async function registerAutomationTrigger(
  env: AutomationTriggerEnv,
  userId: string,
  triggerSlug: string,
): Promise<string | null> {
  const apiKey = await resolveApiKey(env);
  if (!apiKey) {
    return null;
  }
  try {
    const result = await client(apiKey).triggers.create(userId, triggerSlug);
    return result.triggerId;
  } catch (error) {
    createLogger().warn("automation_trigger_register_failed", {
      message: error instanceof Error ? error.message : "unknown",
      triggerSlug,
    });
    return null;
  }
}

/** Pause (disable) / resume (enable) a registered trigger. Fail-soft. */
export async function setAutomationTriggerState(
  env: AutomationTriggerEnv,
  triggerId: string,
  state: "enable" | "disable",
): Promise<void> {
  const apiKey = await resolveApiKey(env);
  if (!apiKey) {
    return;
  }
  try {
    const composio = client(apiKey);
    if (state === "enable") {
      await composio.triggers.enable(triggerId);
    } else {
      await composio.triggers.disable(triggerId);
    }
  } catch (error) {
    createLogger().warn("automation_trigger_state_failed", {
      message: error instanceof Error ? error.message : "unknown",
      state,
    });
  }
}

/** Permanently delete a registered trigger (on automation delete). Fail-soft. */
export async function deleteAutomationTrigger(
  env: AutomationTriggerEnv,
  triggerId: string,
): Promise<void> {
  const apiKey = await resolveApiKey(env);
  if (!apiKey) {
    return;
  }
  try {
    await client(apiKey).triggers.delete(triggerId);
  } catch (error) {
    createLogger().warn("automation_trigger_delete_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}
