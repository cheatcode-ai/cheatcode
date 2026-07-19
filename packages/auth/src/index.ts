import {
  APIError,
  readBoundedResponseJson,
  readBoundedResponseText,
} from "@cheatcode/observability";
import { TokenVerificationError } from "@clerk/backend/errors";
import { decodeJwt, verifyJwt } from "@clerk/backend/jwt";
import { z } from "zod";

export { readCookieValue } from "./cookies";
export {
  assertDistinctHmacSecrets,
  assertHmacSecretStrength,
  hmacSha256Base64,
  MINIMUM_HMAC_SECRET_UTF8_BYTES,
  timingSafeEqual,
} from "./crypto";
export type {
  InternalMaintenanceAudience,
  InternalMaintenanceCapability,
  InternalMaintenanceEnvelopeExpectation,
  InternalMaintenanceIssuer,
} from "./internal-maintenance";
export {
  assertInternalMaintenanceEnvelope,
  createInternalMaintenanceHeaders,
  verifyInternalMaintenanceRequest,
} from "./internal-maintenance";
export type {
  MintedPreviewCapability,
  PreviewCapabilityErrorReason,
  PreviewCapabilityKind,
  PreviewCapabilityTarget,
  VerifiedPreviewCapability,
} from "./preview-capability";
export {
  mintPreviewCapability,
  PREVIEW_HANDOFF_MAX_TTL_MS,
  PREVIEW_SESSION_MAX_TTL_MS,
  PreviewCapabilityError,
  verifyPreviewCapability,
} from "./preview-capability";
export type {
  SkillRuntimeScope,
  VerifiedSkillRuntimeCapability,
} from "./skill-runtime-capability";
export {
  mintSkillRuntimeCapability,
  SKILL_RUNTIME_CAPABILITY_MAX_TTL_MS,
  SkillRuntimeCapabilityError,
  SkillRuntimeScopeSchema,
  verifySkillRuntimeCapability,
} from "./skill-runtime-capability";

const CLERK_API_URL = "https://api.clerk.com/v1";
const CLERK_API_VERSION = "2026-05-12";
const CLERK_REQUEST_TIMEOUT_MS = 10_000;
const CLERK_INSTANCE_RESPONSE_MAX_BYTES = 64 * 1024;
const CLERK_USER_RESPONSE_MAX_BYTES = 512 * 1024;
const CLERK_JWKS_RESPONSE_MAX_BYTES = 64 * 1024;
const CLERK_ERROR_RESPONSE_MAX_BYTES = 64 * 1024;
const CLERK_REQUEST_BODY_MAX_BYTES = 32 * 1024;
const CLERK_SESSION_TOKEN_MAX_CHARACTERS = 16 * 1024;
const CLERK_JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const CLERK_JWKS_CACHE_MAX_INSTANCES = 4;
const CLERK_UNKNOWN_KID_REFRESH_COOLDOWN_MS = 30 * 1000;

export interface VerifiedClerkSession {
  clerkUserId: string;
  claims: Record<string, unknown>;
}

export interface ClerkPrimaryEmailStatus {
  email: string | null;
  verified: boolean;
}

export interface ClerkUserSyncSnapshot {
  avatarUrl: string | null;
  clerkUpdatedAtMs: number;
  displayName: string | null;
  email: string | null;
}

export interface ClerkInstanceIdentity {
  environmentType: "development" | "production";
  instanceId: string;
}

function getBearerToken(request: Request): string {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new APIError(401, "auth_token_missing", "Missing bearer token", {
      hint: "Send Authorization: Bearer <Clerk JWT>.",
      retriable: false,
    });
  }
  const token = header.slice("Bearer ".length);
  if (!token || token.length > CLERK_SESSION_TOKEN_MAX_CHARACTERS) {
    throw new APIError(401, "auth_token_invalid", "Bearer token is invalid", {
      retriable: false,
    });
  }
  return token;
}

export async function verifyClerkBearerToken(
  request: Request,
  options: { authorizedParties: string[]; secretKey?: string; jwtKey?: string },
): Promise<VerifiedClerkSession> {
  const token = getBearerToken(request);
  const payload = await verifyClerkToken(token, options);

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

async function verifyClerkToken(
  token: string,
  options: { authorizedParties: string[]; secretKey?: string; jwtKey?: string },
) {
  try {
    const kid = decodeClerkTokenKid(token);
    const key = options.jwtKey ?? (await clerkJwkForToken(kid, options.secretKey));
    return await verifyJwt(token, {
      authorizedParties: options.authorizedParties,
      key,
    });
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    if (!(error instanceof TokenVerificationError)) {
      throw new APIError(503, "unavailable_maintenance", "Clerk verification is unavailable", {
        cause: error,
        retriable: true,
      });
    }
    throw new APIError(401, "auth_token_invalid", "Invalid or expired bearer token", {
      cause: error,
      hint: "Request a fresh Clerk session token and retry.",
      retriable: false,
    });
  }
}

const ClerkEmailResourceSchema = z
  .object({
    id: z.string().min(1).max(500).optional(),
    email_address: z.string().min(1).max(320),
    verification: z
      .object({
        status: z.string().min(1).max(100).optional(),
      })
      .strip()
      .nullable()
      .optional(),
  })
  .strip();

const ClerkUserResourceSchema = z
  .object({
    first_name: z.string().max(1_024).nullable().optional(),
    image_url: z.string().max(4_096).nullable().optional(),
    last_name: z.string().max(1_024).nullable().optional(),
    primary_email_address_id: z.string().max(500).nullable().optional(),
    email_addresses: z.array(ClerkEmailResourceSchema).max(100).optional(),
    updated_at: z.number().int().safe().nonnegative().optional(),
    username: z.string().max(1_024).nullable().optional(),
  })
  .strip();

const ClerkUserSyncResourceSchema = ClerkUserResourceSchema.required({
  updated_at: true,
});

const ClerkInstanceResourceSchema = z
  .object({
    environment_type: z.enum(["development", "production"]),
    id: z.string().min(1).max(500),
  })
  .strip();

/** Resolve the non-secret identity of the Clerk instance owning a Backend API key. */
export async function fetchClerkInstanceIdentity(input: {
  secretKey: string;
}): Promise<ClerkInstanceIdentity> {
  const response = await clerkApiRequest(input.secretKey, "/instance", { method: "GET" });
  const instance = ClerkInstanceResourceSchema.parse(
    await readBoundedResponseJson(
      response,
      CLERK_INSTANCE_RESPONSE_MAX_BYTES,
      "Clerk instance API",
    ),
  );
  return {
    environmentType: instance.environment_type,
    instanceId: instance.id,
  };
}

function primaryEmailStatusFromClerkUserResource(user: unknown): ClerkPrimaryEmailStatus {
  const parsed = ClerkUserResourceSchema.safeParse(user);
  if (!parsed.success) {
    return { email: null, verified: false };
  }
  const primary = resolvePrimaryEmailResource(parsed.data);
  const address = primary?.email_address.trim();
  return {
    email: address ? address : null,
    verified: primary?.verification?.status === "verified",
  };
}

function displayNameFromClerkUserResource(
  user: z.infer<typeof ClerkUserSyncResourceSchema>,
): string | null {
  const fullName = [user.first_name, user.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return fullName || user.username?.trim() || null;
}

function syncSnapshotFromClerkUserResource(user: unknown): ClerkUserSyncSnapshot {
  const parsed = ClerkUserSyncResourceSchema.parse(user);
  const imageUrl = parsed.image_url?.trim();
  return {
    avatarUrl: imageUrl || null,
    clerkUpdatedAtMs: parsed.updated_at,
    displayName: displayNameFromClerkUserResource(parsed),
    email: primaryEmailStatusFromClerkUserResource(parsed).email,
  };
}

export async function fetchClerkUserPrimaryEmailStatus(input: {
  clerkUserId: string;
  secretKey: string;
}): Promise<ClerkPrimaryEmailStatus> {
  const response = await clerkApiRequest(input.secretKey, clerkUserPath(input.clerkUserId), {
    method: "GET",
  });
  const user = await readBoundedResponseJson(
    response,
    CLERK_USER_RESPONSE_MAX_BYTES,
    "Clerk user API",
  );
  return primaryEmailStatusFromClerkUserResource(user);
}

/** Read the canonical identity fields required for a monotonic database sync. */
export async function fetchClerkUserSyncSnapshot(input: {
  clerkUserId: string;
  secretKey: string;
}): Promise<ClerkUserSyncSnapshot> {
  const response = await clerkApiRequest(input.secretKey, clerkUserPath(input.clerkUserId), {
    method: "GET",
  });
  const user = await readBoundedResponseJson(
    response,
    CLERK_USER_RESPONSE_MAX_BYTES,
    "Clerk user API",
  );
  return syncSnapshotFromClerkUserResource(user);
}

export interface UpdateClerkUserPublicMetadataInput {
  clerkUserId: string;
  metadata: Record<string, unknown>;
  secretKey: string;
}

/** Mirror a value into Clerk `public_metadata` (e.g. the onboarding-complete claim). */
export async function updateClerkUserPublicMetadata(
  input: UpdateClerkUserPublicMetadataInput,
): Promise<void> {
  const response = await clerkApiRequest(
    input.secretKey,
    `${clerkUserPath(input.clerkUserId)}/metadata`,
    {
      body: boundedClerkRequestBody({ public_metadata: input.metadata }),
      method: "PATCH",
    },
  );
  await response.body?.cancel().catch(() => undefined);
}

interface ClerkJwksCacheEntry {
  expiresAt: number;
  keys: Map<string, JsonWebKey>;
  refreshedAt: number;
}

const clerkJwksCache = new Map<string, ClerkJwksCacheEntry>();

const ClerkJwksResponseSchema = z
  .object({
    keys: z
      .array(
        z
          .object({
            alg: z.literal("RS256").optional(),
            e: z.string().min(1).max(100),
            kid: z.string().min(1).max(500),
            kty: z.literal("RSA"),
            n: z.string().min(1).max(10_000),
            use: z.literal("sig").optional(),
          })
          .strip(),
      )
      .min(1)
      .max(20),
  })
  .strip();

async function clerkJwkForToken(
  kid: string | undefined,
  secretKey: string | undefined,
): Promise<JsonWebKey> {
  if (!secretKey) {
    throw new APIError(503, "unavailable_maintenance", "Clerk verification is unavailable", {
      retriable: true,
    });
  }
  if (!kid) {
    throw new APIError(401, "auth_token_invalid", "Clerk token key ID is missing", {
      retriable: false,
    });
  }
  const cacheKey = await secretFingerprint(secretKey);
  const cached = clerkJwksCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const key = cached.keys.get(kid);
    if (key) {
      return key;
    }
    // Refresh an otherwise-live cache after a bounded cooldown so a legitimate
    // signing-key rotation converges quickly without letting attacker-chosen
    // random `kid` values amplify Clerk requests.
    if (cached.refreshedAt + CLERK_UNKNOWN_KID_REFRESH_COOLDOWN_MS > Date.now()) {
      return requireClerkJwk(cached.keys, kid);
    }
  }
  const keys = await fetchClerkJwks(secretKey);
  cacheClerkJwks(cacheKey, keys);
  return requireClerkJwk(keys, kid);
}

function requireClerkJwk(keys: ReadonlyMap<string, JsonWebKey>, kid: string): JsonWebKey {
  const key = keys.get(kid);
  if (!key) {
    throw new APIError(401, "auth_token_invalid", "Clerk token signing key is unknown", {
      retriable: false,
    });
  }
  return key;
}

async function fetchClerkJwks(secretKey: string): Promise<Map<string, JsonWebKey>> {
  const response = await clerkApiRequest(secretKey, "/jwks", { method: "GET" });
  const result = ClerkJwksResponseSchema.safeParse(
    await readBoundedResponseJson(response, CLERK_JWKS_RESPONSE_MAX_BYTES, "Clerk JWKS"),
  );
  if (!result.success) {
    throw new APIError(503, "upstream_provider_outage", "Clerk JWKS response is invalid", {
      retriable: true,
    });
  }
  const parsed = result.data;
  return new Map(
    parsed.keys.map((key) => [
      key.kid,
      {
        ...(key.alg !== undefined ? { alg: key.alg } : {}),
        e: key.e,
        kid: key.kid,
        kty: key.kty,
        n: key.n,
        ...(key.use !== undefined ? { use: key.use } : {}),
      },
    ]),
  );
}

function decodeClerkTokenKid(token: string): string | undefined {
  try {
    const decoded = decodeJwt(token);
    if (!isRecord(decoded.header) || !isRecord(decoded.payload)) {
      throw new TypeError("Clerk token header or payload is invalid");
    }
    const kid = decoded.header["kid"];
    if (kid !== undefined && (typeof kid !== "string" || !kid || kid.length > 500)) {
      throw new TypeError("Clerk token key ID is invalid");
    }
    return kid;
  } catch {
    throw new APIError(401, "auth_token_invalid", "Invalid bearer token", {
      hint: "Request a fresh Clerk session token and retry.",
      retriable: false,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cacheClerkJwks(cacheKey: string, keys: Map<string, JsonWebKey>): void {
  if (!clerkJwksCache.has(cacheKey) && clerkJwksCache.size >= CLERK_JWKS_CACHE_MAX_INSTANCES) {
    const oldest = clerkJwksCache.keys().next().value;
    if (oldest) {
      clerkJwksCache.delete(oldest);
    }
  }
  const refreshedAt = Date.now();
  clerkJwksCache.set(cacheKey, {
    expiresAt: refreshedAt + CLERK_JWKS_CACHE_TTL_MS,
    keys,
    refreshedAt,
  });
}

async function secretFingerprint(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function clerkApiRequest(
  secretKey: string,
  path: string,
  init: { body?: string; method: "GET" | "PATCH" },
): Promise<Response> {
  if (!secretKey.trim() || secretKey.length > 2_000) {
    throw new APIError(503, "unavailable_maintenance", "Clerk credentials are invalid", {
      retriable: false,
    });
  }
  const response = await fetch(`${CLERK_API_URL}${path}`, {
    ...(init.body ? { body: init.body } : {}),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${secretKey}`,
      "Clerk-API-Version": CLERK_API_VERSION,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    method: init.method,
    // Workers does not implement `redirect: "error"`. Manual mode preserves
    // the same fail-closed behavior because every 3xx reaches the non-ok path.
    redirect: "manual",
    signal: AbortSignal.timeout(CLERK_REQUEST_TIMEOUT_MS),
  });
  if (response.ok) {
    return response;
  }
  await readBoundedResponseText(response, CLERK_ERROR_RESPONSE_MAX_BYTES, "Clerk API error").catch(
    () => undefined,
  );
  throw new APIError(503, "upstream_provider_outage", "Clerk Backend API request failed", {
    details: { status: response.status },
    retriable: response.status >= 500 || response.status === 429,
  });
}

function boundedClerkRequestBody(value: Record<string, unknown>): string {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > CLERK_REQUEST_BODY_MAX_BYTES) {
    throw new APIError(400, "invalid_request_body", "Clerk metadata payload is too large", {
      retriable: false,
    });
  }
  return body;
}

function clerkUserPath(userId: string): string {
  if (!userId || userId.length > 500) {
    throw new TypeError("Clerk user ID is invalid");
  }
  return `/users/${encodeURIComponent(userId)}`;
}

function resolvePrimaryEmailResource(
  user: z.infer<typeof ClerkUserResourceSchema>,
): z.infer<typeof ClerkEmailResourceSchema> | undefined {
  const byId = user.email_addresses?.find((email) => email.id === user.primary_email_address_id);
  return byId ?? user.email_addresses?.[0];
}
