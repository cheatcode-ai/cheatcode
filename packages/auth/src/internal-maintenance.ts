import { APIError } from "@cheatcode/observability";
import { hmacSha256Base64Url, sha256Base64Url, timingSafeEqual } from "./crypto";

const INTERNAL_MAINTENANCE_PROTOCOL = "ccm2";
const INTERNAL_MAINTENANCE_METHOD_PATTERN = /^[A-Z]+$/u;
const INTERNAL_MAINTENANCE_SIGNATURE_PATTERN = /^ccm2\.[A-Za-z0-9_-]{43}$/u;
const INTERNAL_MAINTENANCE_TIMESTAMP_PATTERN = /^[1-9]\d{12}$/u;
const INTERNAL_MAINTENANCE_NONCE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_INTERNAL_MAINTENANCE_CLOCK_SKEW_MS = 30 * 1000;
const MAX_INTERNAL_MAINTENANCE_PATHNAME_CHARACTERS = 2_048;

const INTERNAL_MAINTENANCE_CAPABILITIES = [
  "agent-lifecycle",
  "database-readiness",
  "durable-object-schema",
  "resource-deletion",
  "webhook-replay",
] as const;

export type InternalMaintenanceCapability = (typeof INTERNAL_MAINTENANCE_CAPABILITIES)[number];
export type InternalMaintenanceIssuer = "gateway" | "operator" | "release-control" | "webhooks";
export type InternalMaintenanceAudience = "agent" | "gateway" | "webhooks";

export interface InternalMaintenanceEnvelopeExpectation {
  audience: InternalMaintenanceAudience;
  capability: InternalMaintenanceCapability;
  issuer: InternalMaintenanceIssuer;
}

export interface CreateInternalMaintenanceHeadersInput {
  audience: InternalMaintenanceAudience;
  capability: InternalMaintenanceCapability;
  issuer: InternalMaintenanceIssuer;
  method: string;
  pathname: string;
  rawBody: string;
  secret: string;
}

/** Sign a ccm2 issuer/audience/capability request with its exact route, nonce, and body. */
export async function createInternalMaintenanceHeaders(
  input: CreateInternalMaintenanceHeadersInput,
): Promise<Headers> {
  const method = canonicalMethod(input.method);
  const pathname = canonicalPathname(input.pathname);
  const capability = canonicalCapability(input.capability);
  const audience = canonicalAudience(input.audience);
  const issuer = canonicalIssuer(input.issuer);
  const nonce = crypto.randomUUID();
  const timestamp = String(Date.now());
  const canonicalRequest = await canonicalInternalMaintenanceRequest({
    audience,
    capability,
    issuer,
    method,
    nonce,
    pathname,
    rawBody: input.rawBody,
    timestamp,
  });
  const signature = await hmacSha256Base64Url(canonicalRequest, input.secret);
  return new Headers({
    "x-cheatcode-maintenance-audience": audience,
    "x-cheatcode-maintenance-capability": capability,
    "x-cheatcode-maintenance-issuer": issuer,
    "x-cheatcode-maintenance-nonce": nonce,
    "x-cheatcode-maintenance-signature": `${INTERNAL_MAINTENANCE_PROTOCOL}.${signature}`,
    "x-cheatcode-maintenance-timestamp": timestamp,
  });
}

/** Verify the single supported internal-maintenance protocol without legacy fallbacks. */
export async function verifyInternalMaintenanceRequest(input: {
  expectedAudience: InternalMaintenanceAudience;
  expectedCapability: InternalMaintenanceCapability;
  expectedIssuer: InternalMaintenanceIssuer;
  expectedMethod: string;
  expectedPathname: string;
  rawBody: string;
  request: Request;
  secret: string;
}): Promise<void> {
  const envelope = assertInternalMaintenanceEnvelope(input.request, {
    audience: input.expectedAudience,
    capability: input.expectedCapability,
    issuer: input.expectedIssuer,
  });
  const timestamp = input.request.headers.get("x-cheatcode-maintenance-timestamp");
  const signature = input.request.headers.get("x-cheatcode-maintenance-signature");
  if (!timestamp || !signature) {
    throw invalidMaintenanceSignature("Missing internal maintenance signature headers");
  }
  assertFreshMillisecondTimestamp(timestamp);
  if (!INTERNAL_MAINTENANCE_SIGNATURE_PATTERN.test(signature)) {
    throw invalidMaintenanceSignature("Invalid internal maintenance signature format");
  }
  const url = new URL(input.request.url);
  if (url.search || url.hash) {
    throw invalidMaintenanceSignature("Internal maintenance requests cannot include a query");
  }
  const method = canonicalMethod(input.request.method);
  const pathname = canonicalPathname(url.pathname);
  if (
    method !== canonicalMethod(input.expectedMethod) ||
    pathname !== canonicalPathname(input.expectedPathname)
  ) {
    throw invalidMaintenanceSignature("Internal maintenance route does not match its allowlist");
  }
  const canonicalRequest = await canonicalInternalMaintenanceRequest({
    ...envelope,
    method,
    pathname,
    rawBody: input.rawBody,
    timestamp,
  });
  const expected = `${INTERNAL_MAINTENANCE_PROTOCOL}.${await hmacSha256Base64Url(
    canonicalRequest,
    input.secret,
  )}`;
  if (!timingSafeEqual(signature, expected)) {
    throw invalidMaintenanceSignature("Invalid internal maintenance signature");
  }
}

/** Reject a missing, unknown, or cross-boundary envelope before its body is consumed. */
export function assertInternalMaintenanceEnvelope(
  request: Request,
  expected: InternalMaintenanceEnvelopeExpectation,
): {
  audience: InternalMaintenanceAudience;
  capability: InternalMaintenanceCapability;
  issuer: InternalMaintenanceIssuer;
  nonce: string;
} {
  const audience = canonicalAudience(request.headers.get("x-cheatcode-maintenance-audience"));
  const capability = canonicalCapability(request.headers.get("x-cheatcode-maintenance-capability"));
  const issuer = canonicalIssuer(request.headers.get("x-cheatcode-maintenance-issuer"));
  const nonce = canonicalNonce(request.headers.get("x-cheatcode-maintenance-nonce"));
  if (
    audience !== expected.audience ||
    capability !== expected.capability ||
    issuer !== expected.issuer
  ) {
    throw invalidMaintenanceSignature("Internal maintenance envelope does not match this route");
  }
  return { audience, capability, issuer, nonce };
}

async function canonicalInternalMaintenanceRequest(input: {
  audience: InternalMaintenanceAudience;
  capability: InternalMaintenanceCapability;
  issuer: InternalMaintenanceIssuer;
  method: string;
  nonce: string;
  pathname: string;
  rawBody: string;
  timestamp: string;
}): Promise<string> {
  const bodyHash = await sha256Base64Url(input.rawBody);
  return [
    INTERNAL_MAINTENANCE_PROTOCOL,
    input.issuer,
    input.audience,
    input.capability,
    input.method,
    input.pathname,
    input.timestamp,
    input.nonce,
    bodyHash,
  ].join("\n");
}

function canonicalAudience(value: unknown): InternalMaintenanceAudience {
  if (value !== "agent" && value !== "gateway" && value !== "webhooks") {
    throw invalidMaintenanceSignature("Invalid internal maintenance audience");
  }
  return value;
}

function canonicalIssuer(value: unknown): InternalMaintenanceIssuer {
  if (
    value !== "gateway" &&
    value !== "operator" &&
    value !== "release-control" &&
    value !== "webhooks"
  ) {
    throw invalidMaintenanceSignature("Invalid internal maintenance issuer");
  }
  return value;
}

function canonicalNonce(value: unknown): string {
  if (typeof value !== "string" || !INTERNAL_MAINTENANCE_NONCE_PATTERN.test(value)) {
    throw invalidMaintenanceSignature("Invalid internal maintenance nonce");
  }
  return value;
}

function canonicalCapability(value: unknown): InternalMaintenanceCapability {
  if (
    typeof value !== "string" ||
    !INTERNAL_MAINTENANCE_CAPABILITIES.includes(value as InternalMaintenanceCapability)
  ) {
    throw invalidMaintenanceSignature("Invalid internal maintenance capability");
  }
  return value as InternalMaintenanceCapability;
}

function canonicalMethod(value: string): string {
  const method = value.toUpperCase();
  if (!INTERNAL_MAINTENANCE_METHOD_PATTERN.test(method)) {
    throw invalidMaintenanceSignature("Invalid internal maintenance method");
  }
  return method;
}

function canonicalPathname(value: string): string {
  if (
    !value.startsWith("/") ||
    value.length > MAX_INTERNAL_MAINTENANCE_PATHNAME_CHARACTERS ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    throw invalidMaintenanceSignature("Invalid internal maintenance pathname");
  }
  return value;
}

function assertFreshMillisecondTimestamp(value: string): void {
  if (!INTERNAL_MAINTENANCE_TIMESTAMP_PATTERN.test(value)) {
    throw invalidMaintenanceSignature("Invalid internal maintenance timestamp format");
  }
  const timestampMs = Number(value);
  if (
    !Number.isSafeInteger(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > MAX_INTERNAL_MAINTENANCE_CLOCK_SKEW_MS
  ) {
    throw invalidMaintenanceSignature("Stale internal maintenance timestamp");
  }
}

function invalidMaintenanceSignature(message: string): APIError {
  return new APIError(401, "auth_token_invalid", message, { retriable: false });
}
