import { hmacSha256Base64, timingSafeEqual } from "@cheatcode/auth";
import {
  type Database,
  updateUserIntegrationStatusByConnectionId,
  upsertUserIntegration,
} from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { UserId } from "@cheatcode/types";
import { z } from "zod";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const ComposioPayloadSchema = z
  .object({
    data: z.record(z.unknown()).default({}),
    metadata: z.record(z.unknown()).optional(),
    timestamp: z.string().optional(),
    type: z.string().min(1),
  })
  .passthrough();

const InternalUserIdSchema = z
  .string()
  .uuid()
  .transform((value) => UserId(value));

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
): Promise<unknown> {
  if (!input.webhookId || !input.webhookTimestamp || !input.webhookSignature) {
    throw invalidComposioSignature("Missing Composio webhook signature headers");
  }
  assertFreshTimestamp(input.webhookTimestamp);
  const expected = await hmacSha256Base64(
    `${input.webhookId}.${input.webhookTimestamp}.${input.rawBody}`,
    input.secret,
  );
  const received = signaturePayload(input.webhookSignature);
  if (!timingSafeEqual(received, expected)) {
    throw invalidComposioSignature("Invalid Composio webhook signature");
  }
  return JSON.parse(input.rawBody) as unknown;
}

export async function handleComposioWebhookEvent(
  db: Database,
  event: unknown,
): Promise<ComposioWebhookResult> {
  const payload = ComposioPayloadSchema.parse(event);
  const connectionId = connectionIdFromData(payload.data);
  const integration =
    integrationFromData(payload.data) ?? integrationFromMetadata(payload.metadata);
  const userId = userIdFromPayload(payload);

  if (payload.type === "composio.connected_account.expired" && connectionId) {
    const updated = await updateUserIntegrationStatusByConnectionId(db, {
      composioConnectionId: connectionId,
      status: "expired",
    });
    return {
      action: updated ? "integration_expired" : "integration_expired_without_match",
      eventType: payload.type,
    };
  }

  if (connectionId && integration && userId) {
    await upsertUserIntegration(db, {
      composioConnectionId: connectionId,
      integration,
      status: statusFromData(payload.data, payload.type),
      userId,
    });
    return { action: "integration_synced", eventType: payload.type, userId };
  }

  return {
    action: "recorded",
    eventType: payload.type,
    ...(userId ? { userId } : {}),
  };
}

function invalidComposioSignature(message: string): APIError {
  return new APIError(401, "auth_token_invalid", message, { retriable: false });
}

function assertFreshTimestamp(value: string): void {
  const rawTimestamp = Number(value);
  const timestampMs = rawTimestamp > 1_000_000_000_000 ? rawTimestamp : rawTimestamp * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    throw invalidComposioSignature("Stale Composio webhook timestamp");
  }
}

function signaturePayload(signature: string): string {
  const parts = signature.split(",");
  return parts.length > 1 ? (parts[1] ?? "") : signature;
}

function connectionIdFromData(data: Record<string, unknown>): string | null {
  return firstString(data, ["id", "connectedAccountId", "connected_account_id", "accountId"]);
}

function integrationFromData(data: Record<string, unknown>): string | null {
  const toolkit = recordField(data, "toolkit");
  return (
    firstString(data, ["toolkitSlug", "toolkit_slug", "integration", "appName"]) ??
    firstString(toolkit, ["slug", "name"])
  );
}

function integrationFromMetadata(metadata: Record<string, unknown> | undefined): string | null {
  return firstString(metadata, ["toolkitSlug", "toolkit_slug", "integration", "trigger_slug"]);
}

function userIdFromPayload(payload: z.infer<typeof ComposioPayloadSchema>): UserId | null {
  const candidate =
    firstString(payload.data, ["userId", "user_id", "externalUserId", "external_user_id"]) ??
    firstString(payload.metadata, ["userId", "user_id", "externalUserId", "external_user_id"]);
  const parsed = candidate ? InternalUserIdSchema.safeParse(candidate) : null;
  return parsed?.success ? parsed.data : null;
}

function statusFromData(data: Record<string, unknown>, eventType: string): string {
  const status = firstString(data, ["status", "state"]);
  if (status) {
    return status;
  }
  if (eventType.includes("expired")) {
    return "expired";
  }
  if (eventType.includes("deleted") || eventType.includes("revoked")) {
    return "revoked";
  }
  return "connected";
}

function recordField(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = record?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function firstString(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}
