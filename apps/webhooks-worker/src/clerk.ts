import type { ClerkUserSyncInput, ClerkUserSyncResult } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import type { WebhookEvent, WebhookEventType } from "@clerk/backend/webhooks";
import { z } from "zod";

const ClerkEmailAddressSchema = z
  .object({
    id: z.string().min(1),
    email_address: z.string().min(1),
  })
  .passthrough();

const ClerkUserDataSchema = z
  .object({
    first_name: z.string().nullable().optional(),
    id: z.string().min(1),
    image_url: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    primary_email_address_id: z.string().min(1).nullable().optional(),
    email_addresses: z.array(ClerkEmailAddressSchema),
    updated_at: z.number().int().safe().nonnegative(),
    username: z.string().nullable().optional(),
  })
  .passthrough();

const ClerkDeletedUserDataSchema = z
  .object({
    id: z.string().min(1).optional(),
  })
  .passthrough();

type ClerkUserData = z.infer<typeof ClerkUserDataSchema>;

function invalidClerkPayload(message: string): APIError {
  return new APIError(400, "invalid_request_body", message, {
    hint: "Check the Clerk webhook event selection and payload shape.",
    retriable: false,
  });
}

function parseClerkUserData(data: unknown): ClerkUserData {
  const result = ClerkUserDataSchema.safeParse(data);
  if (!result.success) {
    throw invalidClerkPayload("Clerk user webhook payload is invalid");
  }
  return result.data;
}

function parseClerkDeletedUserData(data: unknown): z.infer<typeof ClerkDeletedUserDataSchema> {
  const result = ClerkDeletedUserDataSchema.safeParse(data);
  if (!result.success) {
    throw invalidClerkPayload("Clerk user deletion webhook payload is invalid");
  }
  return result.data;
}

export interface ClerkUserRepository {
  syncUser(input: ClerkUserSyncInput): Promise<ClerkUserSyncResult>;
  markUserDeleted(clerkId: string, deletedAt: Date): Promise<UserId | null>;
}

type ClerkWebhookAction =
  | "deleted"
  | "identity_synced"
  | "identity_unchanged"
  | "skipped"
  | "stale_event_ignored";

export interface ClerkWebhookResult {
  avatarUrl?: string | null;
  clerkId?: string;
  clerkUpdatedAtMs?: number;
  displayName?: string | null;
  email?: string;
  emailChanged?: boolean;
  eventType: WebhookEventType;
  action: ClerkWebhookAction;
  polarCustomerId?: string | null;
  profileChanged?: boolean;
  userId?: UserId;
}

function primaryEmailFromClerkUser(data: ClerkUserData): string | null {
  const email =
    data.email_addresses.find((candidate) => candidate.id === data.primary_email_address_id) ??
    data.email_addresses[0];
  const address = email?.email_address.trim();
  return address ? address : null;
}

function displayNameFromClerkUser(data: ClerkUserData): string | null {
  const fullName = [data.first_name, data.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return fullName || data.username?.trim() || null;
}

function avatarUrlFromClerkUser(data: ClerkUserData): string | null {
  const imageUrl = data.image_url?.trim();
  return imageUrl ? imageUrl : null;
}

export async function handleClerkWebhookEvent(
  repository: ClerkUserRepository,
  event: WebhookEvent,
  acceptedAt: Date,
): Promise<ClerkWebhookResult> {
  switch (event.type) {
    case "user.created":
    case "user.updated":
      return upsertClerkWebhookUser(repository, event);
    case "user.deleted":
      return deleteClerkWebhookUser(repository, event, acceptedAt);
    default:
      return { eventType: event.type, action: "skipped" };
  }
}

async function upsertClerkWebhookUser(
  repository: ClerkUserRepository,
  event: WebhookEvent,
): Promise<ClerkWebhookResult> {
  const data = parseClerkUserData(event.data);
  const email = primaryEmailFromClerkUser(data);
  if (!email) {
    throw new APIError(400, "invalid_request_body", "Clerk user webhook is missing an email", {
      hint: "Configure Clerk to send email_addresses on user.created and user.updated events.",
      retriable: false,
    });
  }
  const syncResult = await repository.syncUser({
    avatarUrl: avatarUrlFromClerkUser(data),
    clerkId: data.id,
    clerkUpdatedAtMs: data.updated_at,
    displayName: displayNameFromClerkUser(data),
    email,
  });
  return {
    action: clerkSyncAction(syncResult.outcome),
    avatarUrl: syncResult.avatarUrl,
    clerkId: data.id,
    clerkUpdatedAtMs: syncResult.clerkUpdatedAtMs,
    displayName: syncResult.displayName,
    email: syncResult.email,
    emailChanged: syncResult.emailChanged,
    eventType: event.type,
    polarCustomerId: syncResult.polarCustomerId,
    profileChanged: syncResult.profileChanged,
    userId: syncResult.userId,
  };
}

function clerkSyncAction(outcome: ClerkUserSyncResult["outcome"]): ClerkWebhookAction {
  if (outcome === "stale") {
    return "stale_event_ignored";
  }
  if (outcome === "unchanged") {
    return "identity_unchanged";
  }
  return "identity_synced";
}

async function deleteClerkWebhookUser(
  repository: ClerkUserRepository,
  event: WebhookEvent,
  acceptedAt: Date,
): Promise<ClerkWebhookResult> {
  const data = parseClerkDeletedUserData(event.data);
  if (!data.id) {
    return { eventType: event.type, action: "skipped" };
  }
  const userId = await repository.markUserDeleted(data.id, acceptedAt);
  return {
    eventType: event.type,
    action: "deleted",
    ...(userId ? { userId } : {}),
  };
}
