import { APIError } from "@cheatcode/observability";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { z } from "zod";

const TEXT_ENCODER = new TextEncoder();
const MAX_INTERNAL_MAINTENANCE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface VerifiedClerkSession {
  clerkUserId: string;
  claims: Record<string, unknown>;
}

export interface ClerkPrimaryEmailStatus {
  email: string | null;
  verified: boolean;
}

export function getBearerToken(request: Request): string {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new APIError(401, "auth_token_missing", "Missing bearer token", {
      hint: "Send Authorization: Bearer <Clerk JWT>.",
      retriable: false,
    });
  }
  return header.slice("Bearer ".length);
}

export async function verifyClerkBearerToken(
  request: Request,
  options: { secretKey?: string; jwtKey?: string },
): Promise<VerifiedClerkSession> {
  const token = getBearerToken(request);
  const payload = await verifyToken(token, {
    secretKey: options.secretKey,
    jwtKey: options.jwtKey,
  });

  if (!payload.sub) {
    throw new APIError(401, "auth_token_invalid", "Token subject is missing", {
      hint: "Request a fresh Clerk session token and retry.",
      retriable: false,
    });
  }

  return {
    clerkUserId: payload.sub,
    claims: payload as Record<string, unknown>,
  };
}

const ClerkEmailResourceSchema = z
  .object({
    id: z.string().min(1).optional(),
    emailAddress: z.string().min(1),
    verification: z
      .object({
        status: z.string().min(1).optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

const ClerkUserResourceSchema = z
  .object({
    primaryEmailAddress: ClerkEmailResourceSchema.nullable().optional(),
    primaryEmailAddressId: z.string().nullable().optional(),
    emailAddresses: z.array(ClerkEmailResourceSchema).optional(),
  })
  .passthrough();

export function primaryEmailFromClerkUserResource(user: unknown): string | null {
  return primaryEmailStatusFromClerkUserResource(user).email;
}

export function primaryEmailStatusFromClerkUserResource(user: unknown): ClerkPrimaryEmailStatus {
  const parsed = ClerkUserResourceSchema.safeParse(user);
  if (!parsed.success) {
    return { email: null, verified: false };
  }
  const primary = resolvePrimaryEmailResource(parsed.data);
  const address = primary?.emailAddress.trim();
  return {
    email: address ? address : null,
    verified: primary?.verification?.status === "verified",
  };
}

export async function fetchClerkUserPrimaryEmail(input: {
  clerkUserId: string;
  secretKey: string;
}): Promise<string | null> {
  return (await fetchClerkUserPrimaryEmailStatus(input)).email;
}

export async function fetchClerkUserPrimaryEmailStatus(input: {
  clerkUserId: string;
  secretKey: string;
}): Promise<ClerkPrimaryEmailStatus> {
  const clerk = createClerkClient({ secretKey: input.secretKey });
  const user = await clerk.users.getUser(input.clerkUserId);
  return primaryEmailStatusFromClerkUserResource(user);
}

function resolvePrimaryEmailResource(
  user: z.infer<typeof ClerkUserResourceSchema>,
): z.infer<typeof ClerkEmailResourceSchema> | undefined {
  if (user.primaryEmailAddress?.emailAddress.trim()) {
    return user.primaryEmailAddress;
  }
  const byId = user.emailAddresses?.find((email) => email.id === user.primaryEmailAddressId);
  return byId ?? user.emailAddresses?.[0];
}

export async function hmacSha256Base64(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, TEXT_ENCODER.encode(message));
  return base64FromBytes(new Uint8Array(signature));
}

export function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = TEXT_ENCODER.encode(left);
  const rightBytes = TEXT_ENCODER.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

export async function verifyInternalMaintenanceRequest(input: {
  rawBody: string;
  request: Request;
  secret: string;
}): Promise<void> {
  const timestamp = input.request.headers.get("x-cheatcode-maintenance-timestamp");
  const signature = input.request.headers.get("x-cheatcode-maintenance-signature");
  if (!timestamp || !signature) {
    throw invalidMaintenanceSignature("Missing internal maintenance signature headers");
  }
  assertFreshMaintenanceTimestamp(timestamp);
  const expected = await hmacSha256Base64(`${timestamp}.${input.rawBody}`, input.secret);
  if (!timingSafeEqual(signaturePayload(signature), expected)) {
    throw invalidMaintenanceSignature("Invalid internal maintenance signature");
  }
}

function invalidMaintenanceSignature(message: string): APIError {
  return new APIError(401, "auth_token_invalid", message, { retriable: false });
}

function assertFreshMaintenanceTimestamp(value: string): void {
  const rawTimestamp = Number(value);
  const timestampMs = rawTimestamp > 1_000_000_000_000 ? rawTimestamp : rawTimestamp * 1000;
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > MAX_INTERNAL_MAINTENANCE_CLOCK_SKEW_MS
  ) {
    throw invalidMaintenanceSignature("Stale internal maintenance timestamp");
  }
}

function signaturePayload(signature: string): string {
  const parts = signature.split(",");
  return parts.length > 1 ? (parts[1] ?? "") : signature;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
