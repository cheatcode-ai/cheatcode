import {
  type InternalAlertPayload,
  internalAlertEventId,
  prepareInternalAlert,
} from "./internal-alert";
import {
  acceptWebhookEvent,
  completeWebhookEvent,
  releaseWebhookEvent,
  type WebhookIdempotencyBindings,
} from "./webhook-idempotency";
import {
  enqueueVerifiedWebhook,
  type WebhookWorkflowBindings,
  type WebhookWorkflowPayload,
} from "./webhook-workflow";

export interface WebhookIngressBindings
  extends WebhookIdempotencyBindings,
    WebhookWorkflowBindings {}

type VerifiedWebhookInput = Pick<WebhookWorkflowPayload, "event" | "eventId" | "provider"> & {
  rawBody: string;
};

export interface EnqueuedWebhookResponse {
  duplicate: boolean;
  workflowId?: string;
}

/** Persist a Worker-owned alert through the same durable path as provider webhooks. */
export async function enqueueInternalAlert(
  env: WebhookIngressBindings,
  input: InternalAlertPayload,
): Promise<EnqueuedWebhookResponse> {
  const alert = prepareInternalAlert(input);
  const rawBody = JSON.stringify(input);
  return acceptAndEnqueueWebhook(env, {
    event: alert,
    eventId: await internalAlertEventId(rawBody),
    provider: "internal-alert",
    rawBody,
  });
}

/** Claim an already verified event and deterministically enqueue its durable Workflow. */
export async function acceptAndEnqueueWebhook(
  env: WebhookIngressBindings,
  input: VerifiedWebhookInput,
): Promise<EnqueuedWebhookResponse> {
  const accepted = await acceptWebhookEvent(env, input);
  // An accepted row can outlive a Worker crash between the DO write and Workflow creation.
  // Re-enqueueing that state is safe because the Workflow id is deterministic.
  if (accepted.action === "duplicate" && accepted.state !== "accepted") {
    return { duplicate: true };
  }
  try {
    const workflow = await enqueueVerifiedWebhook(env, {
      acceptedAt: accepted.acceptedAt,
      bodyHash: accepted.bodyHash,
      event: input.event,
      eventId: input.eventId,
      provider: input.provider,
    });
    if (workflow.status === "complete") {
      await completeWebhookEvent(env, {
        bodyHash: accepted.bodyHash,
        eventId: input.eventId,
        provider: input.provider,
        workflowId: workflow.id,
      });
    }
    return { duplicate: accepted.action === "duplicate", workflowId: workflow.id };
  } catch (error) {
    await releaseWebhookEvent(env, {
      bodyHash: accepted.bodyHash,
      eventId: input.eventId,
      provider: input.provider,
    });
    throw error;
  }
}
