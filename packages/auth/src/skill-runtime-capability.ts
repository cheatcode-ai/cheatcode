import { z } from "zod";
import { hmacSha256Base64Url, timingSafeEqual } from "./crypto";

export const SKILL_RUNTIME_CAPABILITY_MAX_TTL_MS = 65 * 60_000;

const CAPABILITY_PREFIX = "ccs1";
const CAPABILITY_VERSION = 1;
const MAX_FUTURE_ISSUED_AT_MS = 5_000;
const MAX_TOKEN_LENGTH = 4_096;
const MAX_ENCODED_PAYLOAD_LENGTH = 3_072;
const MAX_DECODED_PAYLOAD_BYTES = 2_304;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SIGNATURE_LENGTH = 43;
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const TEXT_ENCODER = new TextEncoder();

export const SkillRuntimeScopeSchema = z.enum([
  "events:write",
  "integrations:execute",
  "skills:read",
  "skills:write",
]);

const SkillRuntimeCapabilityPayloadSchema = z
  .object({
    exp: z.number().int().positive().safe(),
    iat: z.number().int().positive().safe(),
    projectId: z.string().uuid().nullable(),
    runId: z.string().uuid(),
    scopes: z.array(SkillRuntimeScopeSchema).min(1).max(4),
    userId: z.string().uuid(),
    v: z.literal(CAPABILITY_VERSION),
  })
  .strict();

type SkillRuntimeCapabilityPayload = z.infer<typeof SkillRuntimeCapabilityPayloadSchema>;
export type SkillRuntimeScope = z.infer<typeof SkillRuntimeScopeSchema>;

export interface VerifiedSkillRuntimeCapability {
  expiresAt: number;
  issuedAt: number;
  projectId: string | null;
  runId: string;
  scopes: SkillRuntimeScope[];
  userId: string;
}

export class SkillRuntimeCapabilityError extends Error {
  public readonly reason: "expired" | "invalid";

  public constructor(reason: "expired" | "invalid") {
    super(
      reason === "expired"
        ? "Skill runtime capability has expired"
        : "Invalid skill runtime capability",
    );
    this.name = "SkillRuntimeCapabilityError";
    this.reason = reason;
  }
}

/** Mints a short-lived run-bound capability for sandbox skill packages. */
export async function mintSkillRuntimeCapability(input: {
  projectId?: string | undefined;
  runId: string;
  scopes: readonly SkillRuntimeScope[];
  secret: string;
  userId: string;
}): Promise<{ expiresAt: number; token: string }> {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SKILL_RUNTIME_CAPABILITY_MAX_TTL_MS;
  const payload = SkillRuntimeCapabilityPayloadSchema.parse({
    exp: expiresAt,
    iat: issuedAt,
    projectId: input.projectId ?? null,
    runId: input.runId,
    scopes: [...new Set(input.scopes)].sort(),
    userId: input.userId,
    v: CAPABILITY_VERSION,
  });
  const encodedPayload = encodePayload(payload);
  const unsigned = `${CAPABILITY_PREFIX}.${encodedPayload}`;
  const signature = await hmacSha256Base64Url(unsigned, input.secret);
  return { expiresAt, token: `${unsigned}.${signature}` };
}

/** Verifies signature, lifetime, run identity, and required scope. */
export async function verifySkillRuntimeCapability(input: {
  requiredScope: SkillRuntimeScope;
  secret: string;
  token: string;
}): Promise<VerifiedSkillRuntimeCapability> {
  const payload = await verifyToken(input.token, input.secret);
  if (!payload.scopes.includes(input.requiredScope)) {
    throw invalidCapability();
  }
  return {
    expiresAt: payload.exp,
    issuedAt: payload.iat,
    projectId: payload.projectId,
    runId: payload.runId,
    scopes: payload.scopes,
    userId: payload.userId,
  };
}

async function verifyToken(token: string, secret: string): Promise<SkillRuntimeCapabilityPayload> {
  if (!secret || token.length > MAX_TOKEN_LENGTH) {
    throw invalidCapability();
  }
  const [prefix, encodedPayload, signature, ...extra] = token.split(".");
  if (
    extra.length > 0 ||
    prefix !== CAPABILITY_PREFIX ||
    !encodedPayload ||
    encodedPayload.length > MAX_ENCODED_PAYLOAD_LENGTH ||
    !BASE64_URL_PATTERN.test(encodedPayload) ||
    !signature ||
    signature.length !== SIGNATURE_LENGTH ||
    !BASE64_URL_PATTERN.test(signature)
  ) {
    throw invalidCapability();
  }
  const expectedSignature = await hmacSha256Base64Url(`${prefix}.${encodedPayload}`, secret);
  if (!timingSafeEqual(signature, expectedSignature)) {
    throw invalidCapability();
  }
  const payload = decodePayload(encodedPayload);
  const now = Date.now();
  const lifetime = payload.exp - payload.iat;
  if (
    payload.iat > now + MAX_FUTURE_ISSUED_AT_MS ||
    lifetime <= 0 ||
    lifetime > SKILL_RUNTIME_CAPABILITY_MAX_TTL_MS
  ) {
    throw invalidCapability();
  }
  if (payload.exp <= now) {
    throw new SkillRuntimeCapabilityError("expired");
  }
  return payload;
}

function encodePayload(payload: SkillRuntimeCapabilityPayload): string {
  const bytes = TEXT_ENCODER.encode(JSON.stringify(payload));
  if (bytes.byteLength > MAX_DECODED_PAYLOAD_BYTES) {
    throw new TypeError("Skill runtime capability payload exceeds the protocol limit");
  }
  return base64UrlFromBytes(bytes);
}

function decodePayload(encoded: string): SkillRuntimeCapabilityPayload {
  try {
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(`${normalized}${padding}`);
    if (binary.length > MAX_DECODED_PAYLOAD_BYTES) {
      throw invalidCapability();
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return SkillRuntimeCapabilityPayloadSchema.parse(JSON.parse(TEXT_DECODER.decode(bytes)));
  } catch (error) {
    if (error instanceof SkillRuntimeCapabilityError) throw error;
    throw invalidCapability();
  }
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function invalidCapability(): SkillRuntimeCapabilityError {
  return new SkillRuntimeCapabilityError("invalid");
}
