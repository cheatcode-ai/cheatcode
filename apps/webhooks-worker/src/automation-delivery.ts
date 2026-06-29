import type { AutomationDelivery, AutomationDeliveryChannel } from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { createLogger } from "@cheatcode/observability";
import { Composio } from "@composio/core";

interface DeliveryEnv {
  COMPOSIO_API_KEY?: WorkerSecret;
}

const MAX_SUMMARY_CHARS = 3500;

/** Deliver a run summary to each configured channel via Composio actions. Best-effort:
 * every channel is attempted, failures are recorded per-channel and never throw, so a
 * delivery problem can't roll back a completed run. Telegram/SMS are intentionally absent. */
export async function deliverAutomationSummary(
  env: DeliveryEnv,
  input: {
    userId: string;
    automationName: string;
    summary: string;
    channels: AutomationDeliveryChannel[];
  },
): Promise<AutomationDelivery[]> {
  if (input.channels.length === 0) {
    return [];
  }
  const apiKey = await resolveWorkerSecret(env.COMPOSIO_API_KEY).catch(() => undefined);
  if (!apiKey) {
    return input.channels.map((channel) => ({
      type: channel.type,
      target: channel.target,
      status: "failed" as const,
      error: "Composio API key not configured",
    }));
  }
  const composio = new Composio({
    allowTracking: false,
    apiKey,
    baseURL: "https://backend.composio.dev",
  });
  const summary = input.summary.slice(0, MAX_SUMMARY_CHARS);

  const results: AutomationDelivery[] = [];
  for (const channel of input.channels) {
    try {
      await executeDelivery(composio, input.userId, channel, summary, input.automationName);
      results.push({ type: channel.type, target: channel.target, status: "delivered" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "delivery failed";
      createLogger().warn("automation_delivery_failed", { channel: channel.type, message });
      results.push({
        type: channel.type,
        target: channel.target,
        status: "failed",
        error: message,
      });
    }
  }
  return results;
}

async function executeDelivery(
  composio: Composio,
  userId: string,
  channel: AutomationDeliveryChannel,
  summary: string,
  automationName: string,
): Promise<void> {
  const result = await composio.tools.execute(deliverySlug(channel.type), {
    arguments: deliveryArguments(channel, summary, automationName),
    userId,
  });
  if (!result.successful) {
    throw new Error(result.error ?? "Composio tool execution failed");
  }
}

function deliverySlug(type: AutomationDeliveryChannel["type"]): string {
  if (type === "slack") {
    return "SLACK_SEND_MESSAGE";
  }
  if (type === "notion") {
    return "NOTION_CREATE_NOTION_PAGE";
  }
  return "GMAIL_SEND_EMAIL";
}

function deliveryArguments(
  channel: AutomationDeliveryChannel,
  summary: string,
  automationName: string,
): Record<string, unknown> {
  if (channel.type === "slack") {
    return { channel: channel.target, markdown_text: `*${automationName}*\n${summary}` };
  }
  if (channel.type === "notion") {
    return { parent_id: channel.target, title: automationName, markdown: summary };
  }
  return {
    recipient_email: channel.target,
    subject: `Automation: ${automationName}`,
    body: summary,
  };
}
