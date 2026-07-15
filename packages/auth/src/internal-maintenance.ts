import { APIError } from "@cheatcode/observability";
import { hmacSha256Base64Url, sha256Base64Url, timingSafeEqual } from "./crypto";

const INTERNAL_MAINTENANCE_PROTOCOL = "ccm1";
const INTERNAL_MAINTENANCE_METHOD_PATTERN = /^[A-Z]+$/u;
const INTERNAL_MAINTENANCE_SIGNATURE_PATTERN = /^ccm1\.[A-Za-z0-9_-]{43}$/u;
const INTERNAL_MAINTENANCE_TIMESTAMP_PATTERN = /^[1-9]\d{12}$/u;
const MAX_INTERNAL_MAINTENANCE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_INTERNAL_MAINTENANCE_PATHNAME_CHARACTERS = 2_048;

export interface CreateInternalMaintenanceHeadersInput {
  method: string;
  pathname: string;
  rawBody: string;
  secret: string;
}

/** Sign a service-binding-safe internal request using its method, path, timestamp, and body hash. */
export async function createInternalMaintenanceHeaders(
  input: CreateInternalMaintenanceHeadersInput,
): Promise<Headers> {
  const method = canonicalMethod(input.method);
  const pathname = canonicalPathname(input.pathname);
  const timestamp = String(Date.now());
  const canonicalRequest = await canonicalInternalMaintenanceRequest({
    method,
    pathname,
    rawBody: input.rawBody,
    timestamp,
  });
  const signature = await hmacSha256Base64Url(canonicalRequest, input.secret);
  return new Headers({
    "x-cheatcode-maintenance-signature": `${INTERNAL_MAINTENANCE_PROTOCOL}.${signature}`,
    "x-cheatcode-maintenance-timestamp": timestamp,
  });
}

/** Verify the single supported internal-maintenance protocol without legacy fallbacks. */
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
  assertFreshMillisecondTimestamp(timestamp);
  if (!INTERNAL_MAINTENANCE_SIGNATURE_PATTERN.test(signature)) {
    throw invalidMaintenanceSignature("Invalid internal maintenance signature format");
  }
  const url = new URL(input.request.url);
  if (url.search || url.hash) {
    throw invalidMaintenanceSignature("Internal maintenance requests cannot include a query");
  }
  const canonicalRequest = await canonicalInternalMaintenanceRequest({
    method: canonicalMethod(input.request.method),
    pathname: canonicalPathname(url.pathname),
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

async function canonicalInternalMaintenanceRequest(input: {
  method: string;
  pathname: string;
  rawBody: string;
  timestamp: string;
}): Promise<string> {
  const bodyHash = await sha256Base64Url(input.rawBody);
  return [
    INTERNAL_MAINTENANCE_PROTOCOL,
    input.method,
    input.pathname,
    input.timestamp,
    bodyHash,
  ].join("\n");
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
