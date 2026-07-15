import { z } from "zod";
import { hmacSha256Base64Url, timingSafeEqual } from "./crypto";

export const PREVIEW_HANDOFF_MAX_TTL_MS = 60_000;
export const PREVIEW_SESSION_MAX_TTL_MS = 10 * 60_000;

const PREVIEW_CAPABILITY_PREFIX = "ccp1";
const PREVIEW_CAPABILITY_VERSION = 1;
const MAX_FUTURE_ISSUED_AT_MS = 5_000;
const MAX_TOKEN_LENGTH = 2_048;
const MAX_ENCODED_PAYLOAD_LENGTH = 1_024;
const MAX_DECODED_PAYLOAD_BYTES = 768;
const NONCE_BYTES = 16;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SIGNATURE_LENGTH = 43;
const SANDBOX_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const TEXT_ENCODER = new TextEncoder();

export type PreviewCapabilityKind = "handoff" | "session";
export type PreviewCapabilityErrorReason = "expired" | "invalid";

const PreviewCapabilityPayloadSchema = z
  .object({
    aud: z.string().min(1).max(253),
    exp: z.number().int().positive().safe(),
    iat: z.number().int().positive().safe(),
    kind: z.enum(["handoff", "session"]),
    nonce: z.string().length(22).regex(BASE64_URL_PATTERN),
    port: z.number().int().min(1).max(65_535),
    sid: z.string().min(1).max(128).regex(SANDBOX_ID_PATTERN),
    v: z.literal(PREVIEW_CAPABILITY_VERSION),
  })
  .strict();

interface PreviewCapabilityPayload extends z.infer<typeof PreviewCapabilityPayloadSchema> {}

export interface PreviewCapabilityTarget {
  audience: string;
  port: number;
  sandboxId: string;
}

export interface MintedPreviewCapability {
  expiresAt: number;
  token: string;
}

export interface VerifiedPreviewCapability {
  audience: string;
  expiresAt: number;
  issuedAt: number;
  kind: PreviewCapabilityKind;
  nonce: string;
  port: number;
  sandboxId: string;
}

export class PreviewCapabilityError extends Error {
  public readonly reason: PreviewCapabilityErrorReason;

  public constructor(reason: PreviewCapabilityErrorReason) {
    super(reason === "expired" ? "Preview capability has expired" : "Invalid preview capability");
    this.name = "PreviewCapabilityError";
    this.reason = reason;
  }
}

/** Mint a versioned, host-bound preview capability with the protocol's fixed lifetime. */
export async function mintPreviewCapability(input: {
  kind: PreviewCapabilityKind;
  secret: string;
  target: PreviewCapabilityTarget;
}): Promise<MintedPreviewCapability> {
  assertSecret(input.secret);
  const target = parseTarget(input.target);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + lifetimeForKind(input.kind);
  const payload: PreviewCapabilityPayload = {
    aud: target.audience,
    exp: expiresAt,
    iat: issuedAt,
    kind: input.kind,
    nonce: randomNonce(),
    port: target.port,
    sid: target.sandboxId,
    v: PREVIEW_CAPABILITY_VERSION,
  };
  const encodedPayload = encodePayload(payload);
  const unsigned = `${PREVIEW_CAPABILITY_PREFIX}.${encodedPayload}`;
  const signature = await hmacSha256Base64Url(unsigned, input.secret);
  return { expiresAt, token: `${unsigned}.${signature}` };
}

/** Verify signature, version, transport kind, host binding, target, and protocol lifetime. */
export async function verifyPreviewCapability(input: {
  expectedKind: PreviewCapabilityKind;
  secret: string;
  target: PreviewCapabilityTarget;
  token: string;
}): Promise<VerifiedPreviewCapability> {
  if (!input.secret || input.token.length > MAX_TOKEN_LENGTH) {
    throw invalidCapability();
  }
  const [prefix, encodedPayload, signature, ...extra] = input.token.split(".");
  if (
    extra.length > 0 ||
    prefix !== PREVIEW_CAPABILITY_PREFIX ||
    !encodedPayload ||
    encodedPayload.length > MAX_ENCODED_PAYLOAD_LENGTH ||
    !BASE64_URL_PATTERN.test(encodedPayload) ||
    !signature ||
    signature.length !== SIGNATURE_LENGTH ||
    !BASE64_URL_PATTERN.test(signature)
  ) {
    throw invalidCapability();
  }
  const expectedSignature = await hmacSha256Base64Url(`${prefix}.${encodedPayload}`, input.secret);
  if (!timingSafeEqual(signature, expectedSignature)) {
    throw invalidCapability();
  }
  const payload = decodePayload(encodedPayload);
  const target = parseTargetForVerification(input.target);
  assertCapabilityClaims(payload, input.expectedKind, target);
  return {
    audience: payload.aud,
    expiresAt: payload.exp,
    issuedAt: payload.iat,
    kind: payload.kind,
    nonce: payload.nonce,
    port: payload.port,
    sandboxId: payload.sid,
  };
}

function assertCapabilityClaims(
  payload: PreviewCapabilityPayload,
  expectedKind: PreviewCapabilityKind,
  target: PreviewCapabilityTarget,
): void {
  const now = Date.now();
  const lifetime = payload.exp - payload.iat;
  if (
    payload.kind !== expectedKind ||
    payload.aud !== target.audience ||
    payload.sid !== target.sandboxId ||
    payload.port !== target.port ||
    payload.iat > now + MAX_FUTURE_ISSUED_AT_MS ||
    lifetime <= 0 ||
    lifetime > lifetimeForKind(payload.kind)
  ) {
    throw invalidCapability();
  }
  if (payload.exp <= now) {
    throw new PreviewCapabilityError("expired");
  }
}

function encodePayload(payload: PreviewCapabilityPayload): string {
  const bytes = TEXT_ENCODER.encode(JSON.stringify(payload));
  if (bytes.byteLength > MAX_DECODED_PAYLOAD_BYTES) {
    throw new TypeError("Preview capability payload exceeds the protocol limit");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodePayload(encoded: string): PreviewCapabilityPayload {
  try {
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(`${normalized}${padding}`);
    if (binary.length > MAX_DECODED_PAYLOAD_BYTES) {
      throw invalidCapability();
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(TEXT_DECODER.decode(bytes));
    const payload = PreviewCapabilityPayloadSchema.safeParse(parsed);
    if (!payload.success || canonicalAudience(payload.data.aud) !== payload.data.aud) {
      throw invalidCapability();
    }
    return payload.data;
  } catch (error) {
    if (error instanceof PreviewCapabilityError) {
      throw error;
    }
    throw invalidCapability();
  }
}

function parseTarget(target: PreviewCapabilityTarget): PreviewCapabilityTarget {
  const parsed = parseTargetForVerification(target);
  if (parsed.audience !== target.audience || parsed.sandboxId !== target.sandboxId) {
    throw new TypeError("Preview capability targets must use canonical lowercase identifiers");
  }
  return parsed;
}

function parseTargetForVerification(target: PreviewCapabilityTarget): PreviewCapabilityTarget {
  if (
    !Number.isInteger(target.port) ||
    target.port < 1 ||
    target.port > 65_535 ||
    target.sandboxId.length > 128 ||
    !SANDBOX_ID_PATTERN.test(target.sandboxId)
  ) {
    throw invalidCapability();
  }
  return {
    audience: canonicalAudience(target.audience),
    port: target.port,
    sandboxId: target.sandboxId.toLowerCase(),
  };
}

function canonicalAudience(value: string): string {
  const audience = value.trim().toLowerCase();
  if (!audience || audience.length > 253 || audience.includes("/") || audience.includes("@")) {
    throw invalidCapability();
  }
  const colon = audience.lastIndexOf(":");
  const hasPort = colon !== -1;
  const hostname = hasPort ? audience.slice(0, colon) : audience;
  const port = hasPort ? audience.slice(colon + 1) : null;
  if (
    !hostname ||
    hostname.length > 253 ||
    hostname.endsWith(".") ||
    hostname.split(".").some((label) => !HOST_LABEL_PATTERN.test(label)) ||
    (port !== null && (!/^\d{1,5}$/u.test(port) || Number(port) > 65_535 || Number(port) < 1))
  ) {
    throw invalidCapability();
  }
  return audience;
}

function lifetimeForKind(kind: PreviewCapabilityKind): number {
  return kind === "handoff" ? PREVIEW_HANDOFF_MAX_TTL_MS : PREVIEW_SESSION_MAX_TTL_MS;
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function assertSecret(secret: string): void {
  if (!secret) {
    throw new TypeError("Preview capability secret is required");
  }
}

function invalidCapability(): PreviewCapabilityError {
  return new PreviewCapabilityError("invalid");
}
