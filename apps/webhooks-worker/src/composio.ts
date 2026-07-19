import { hmacSha256Base64, timingSafeEqual } from "@cheatcode/auth";
import { type Database, expireComposioConnection } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { ComposioConnectionIdSchema, UserId } from "@cheatcode/types";
import { z } from "zod";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const COMPOSIO_ID_MAX_CHARACTERS = 512;
const COMPOSIO_SLUG_MAX_CHARACTERS = 256;
const V1_SIGNATURE_PATTERN = /^v1,([A-Za-z0-9+/]{43}=)$/;

const InternalUserIdSchema = z
  .string()
  .uuid()
  .transform((value) => UserId(value));

const ComposioEventIdSchema = z.string().min(1).max(COMPOSIO_ID_MAX_CHARACTERS);
const ComposioTimestampSchema = z.string().datetime({ offset: true });
const ComposioSlugSchema = z.string().trim().min(1).max(COMPOSIO_SLUG_MAX_CHARACTERS);

const ComposioTriggerMessageSchema = z
  .object({
    data: z.record(z.string(), z.unknown()),
    id: ComposioEventIdSchema,
    metadata: z
      .object({
        auth_config_id: ComposioEventIdSchema,
        connected_account_id: ComposioConnectionIdSchema,
        log_id: ComposioEventIdSchema,
        trigger_id: ComposioEventIdSchema,
        trigger_slug: ComposioSlugSchema,
        user_id: InternalUserIdSchema,
      })
      .strict(),
    timestamp: ComposioTimestampSchema,
    type: z.literal("composio.trigger.message"),
  })
  .strict();

const ComposioConnectionExpiredSchema = z
  .object({
    data: z
      .object({
        id: ComposioConnectionIdSchema,
        status: z.literal("EXPIRED"),
        toolkit: z.object({ slug: ComposioSlugSchema }).strip(),
      })
      .strip(),
    id: ComposioEventIdSchema,
    metadata: z
      .object({
        org_id: ComposioEventIdSchema,
        project_id: ComposioEventIdSchema,
      })
      .strict(),
    timestamp: ComposioTimestampSchema,
    type: z.literal("composio.connected_account.expired"),
  })
  .strict();

const ComposioWebhookEventSchema = z.discriminatedUnion("type", [
  ComposioTriggerMessageSchema,
  ComposioConnectionExpiredSchema,
]);

type ComposioWebhookEvent = z.infer<typeof ComposioWebhookEventSchema>;

export interface ComposioWebhookVerificationInput {
  rawBody: string;
  secret: string;
  webhookId: string | null;
  webhookSignature: string | null;
  webhookTimestamp: string | null;
}

export interface ComposioWebhookResult {
  action: string;
  eventType: string;
  userId?: UserId;
}

export async function verifyComposioWebhook(
  input: ComposioWebhookVerificationInput,
): Promise<ComposioWebhookEvent> {
  if (!input.webhookId || !input.webhookTimestamp || !input.webhookSignature) {
    throw invalidComposioSignature("Missing Composio webhook signature headers");
  }
  assertFreshTimestamp(input.webhookTimestamp);
  const expected = await hmacSha256Base64(
    `${input.webhookId}.${input.webhookTimestamp}.${input.rawBody}`,
    input.secret,
  );
  const received = v1SignaturePayloads(input.webhookSignature);
  if (!received.some((signature) => timingSafeEqual(signature, expected))) {
    throw invalidComposioSignature("Invalid Composio webhook signature");
  }
  return parseComposioEvent(input.rawBody);
}

export async function handleComposioWebhookEvent(
  db: Database,
  event: unknown,
): Promise<ComposioWebhookResult> {
  const payload = ComposioWebhookEventSchema.parse(event);
  if (payload.type === "composio.trigger.message") {
    return {
      action: "recorded",
      eventType: payload.type,
      userId: payload.metadata.user_id,
    };
  }

  const updated = await expireComposioConnection(db, payload.data.id);
  return {
    action: updated ? "integration_expired" : "integration_expired_without_match",
    eventType: payload.type,
  };
}

function parseComposioEvent(rawBody: string): ComposioWebhookEvent {
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new APIError(400, "invalid_request_body", "Composio webhook JSON is invalid", {
      retriable: false,
    });
  }
  const parsed = ComposioWebhookEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new APIError(
      400,
      "invalid_request_body",
      "Unsupported or invalid Composio V3 webhook payload",
      { retriable: false },
    );
  }
  return parsed.data;
}

function invalidComposioSignature(message: string): APIError {
  return new APIError(401, "auth_token_invalid", message, { retriable: false });
}

function assertFreshTimestamp(value: string): void {
  if (!/^[0-9]+$/.test(value)) {
    throw invalidComposioSignature("Invalid Composio webhook timestamp");
  }
  const timestampSeconds = Number(value);
  const timestampMs = timestampSeconds * 1000;
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    !Number.isSafeInteger(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS
  ) {
    throw invalidComposioSignature("Stale Composio webhook timestamp");
  }
}

function v1SignaturePayloads(signature: string): string[] {
  const payloads: string[] = [];
  for (const candidate of signature.split(" ")) {
    const payload = V1_SIGNATURE_PATTERN.exec(candidate)?.[1];
    if (!payload) {
      throw invalidComposioSignature("Invalid Composio webhook signature format");
    }
    payloads.push(payload);
  }
  return payloads;
}
