import { z } from "zod";
import { timingSafeEqual } from "./crypto";

export const SKILL_RUNTIME_CAPABILITY_TTL_MS = 15 * 60_000;

const CAPABILITY_PREFIX = "ccr1";
const CAPABILITY_TOKEN_ID_BYTES = 16;
const CAPABILITY_SECRET_BYTES = 32;
const CAPABILITY_TOKEN_ID_LENGTH = 22;
const CAPABILITY_SECRET_LENGTH = 43;
const CAPABILITY_DIGEST_LENGTH = 43;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const TEXT_ENCODER = new TextEncoder();

export interface MintedSkillRuntimeCapability {
  digest: string;
  expiresAt: number;
  issuedAt: number;
  token: string;
  tokenId: string;
}

export interface ParsedSkillRuntimeCapability {
  runId: string;
  tokenId: string;
  userId: string;
}

const RunIdSchema = z.string().uuid();

/** Creates one opaque, run-routable bearer capability and its storage-safe digest. */
export async function mintSkillRuntimeCapability(input: {
  runId: string;
  userId: string;
}): Promise<MintedSkillRuntimeCapability> {
  const parsedRunId = RunIdSchema.parse(input.runId);
  const parsedUserId = RunIdSchema.parse(input.userId);
  const tokenId = randomBase64Url(CAPABILITY_TOKEN_ID_BYTES);
  const secret = randomBase64Url(CAPABILITY_SECRET_BYTES);
  const token = `${CAPABILITY_PREFIX}.${parsedRunId}.${parsedUserId}.${tokenId}.${secret}`;
  const issuedAt = Date.now();
  return {
    digest: await skillRuntimeCapabilityDigest(token),
    expiresAt: issuedAt + SKILL_RUNTIME_CAPABILITY_TTL_MS,
    issuedAt,
    token,
    tokenId,
  };
}

/** Extracts only the non-secret routing fields from a strictly formed capability. */
export function parseSkillRuntimeCapability(token: string): ParsedSkillRuntimeCapability | null {
  const [prefix, runId, userId, tokenId, secret, ...extra] = token.split(".");
  if (
    extra.length > 0 ||
    prefix !== CAPABILITY_PREFIX ||
    !runId ||
    !RunIdSchema.safeParse(runId).success ||
    !userId ||
    !RunIdSchema.safeParse(userId).success ||
    !isBase64UrlOfLength(tokenId, CAPABILITY_TOKEN_ID_LENGTH) ||
    !isBase64UrlOfLength(secret, CAPABILITY_SECRET_LENGTH)
  ) {
    return null;
  }
  return { runId, tokenId, userId };
}

/** Verifies an opaque token against a digest without exposing timing-sensitive equality. */
export async function verifySkillRuntimeCapabilityDigest(
  token: string,
  expectedDigest: string,
): Promise<boolean> {
  if (
    expectedDigest.length !== CAPABILITY_DIGEST_LENGTH ||
    !BASE64_URL_PATTERN.test(expectedDigest) ||
    parseSkillRuntimeCapability(token) === null
  ) {
    return false;
  }
  return timingSafeEqual(await skillRuntimeCapabilityDigest(token), expectedDigest);
}

async function skillRuntimeCapabilityDigest(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(token));
  return base64UrlFromBytes(new Uint8Array(digest));
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlFromBytes(bytes);
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function isBase64UrlOfLength(value: string | undefined, length: number): value is string {
  return Boolean(value && value.length === length && BASE64_URL_PATTERN.test(value));
}
