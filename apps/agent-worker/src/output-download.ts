import { APIError } from "@cheatcode/observability";
import {
  type OutputDownloadUrlResponse,
  OutputDownloadUrlResponseSchema,
  UserId,
  type UserId as UserIdType,
} from "@cheatcode/types";
import { z } from "zod";

const DEFAULT_OUTPUT_DOWNLOAD_BASE_URL = "https://gateway.trycheatcode.com";
const OUTPUT_DOWNLOAD_TTL_SECONDS = 60 * 60;
const MINIMUM_SIGNING_SECRET_BYTES = 32;
const MAXIMUM_SIGNING_SECRET_BYTES = 1_024;

export const OutputDownloadQuerySchema = z
  .object({
    expires: z.coerce.number().int().positive(),
    sig: z.string().min(32).max(256),
    userId: z.string().uuid().transform(UserId),
  })
  .strict();

export interface CreateOutputDownloadCapabilityInput {
  baseUrl?: string | undefined;
  outputId: string;
  secret: string | undefined;
  userId: UserIdType;
}

export interface VerifySignedOutputDownloadInput {
  expires: number;
  nowSeconds?: number;
  outputId: string;
  secret: string | undefined;
  signature: string;
  userId: UserIdType;
}

export async function createOutputDownloadCapability(
  input: CreateOutputDownloadCapabilityInput,
): Promise<OutputDownloadUrlResponse> {
  const expires = Math.floor(Date.now() / 1000) + OUTPUT_DOWNLOAD_TTL_SECONDS;
  const signature = await signOutputDownload({
    expires,
    outputId: input.outputId,
    secret: requiredSigningSecret(input.secret),
    userId: input.userId,
  });
  const url = new URL(
    `/v1/outputs/${input.outputId}/download`,
    normalizeOutputDownloadBaseUrl(input.baseUrl),
  );
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("sig", signature);
  url.searchParams.set("userId", input.userId);
  return OutputDownloadUrlResponseSchema.parse({
    downloadUrl: url.toString(),
    expiresAt: new Date(expires * 1_000).toISOString(),
  });
}

export async function verifySignedOutputDownload(
  input: VerifySignedOutputDownloadInput,
): Promise<boolean> {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (input.expires < nowSeconds) {
    return false;
  }
  const expected = await signOutputDownload({
    expires: input.expires,
    outputId: input.outputId,
    secret: requiredSigningSecret(input.secret),
    userId: input.userId,
  });
  return constantTimeEqual(expected, input.signature);
}

function normalizeOutputDownloadBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  const candidate = trimmed && trimmed.length > 0 ? trimmed : DEFAULT_OUTPUT_DOWNLOAD_BASE_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw invalidDownloadBaseUrl();
  }
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    (url.protocol !== "https:" && !(isLoopback && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw invalidDownloadBaseUrl();
  }
  return url.origin;
}

function invalidDownloadBaseUrl(): APIError {
  return new APIError(500, "internal_error", "Artifact download origin is invalid", {
    hint: "Use an HTTPS origin, or an HTTP loopback origin in local development.",
    retriable: false,
  });
}

function requiredSigningSecret(value: string | undefined): string {
  const trimmed = value?.trim();
  const size = trimmed ? new TextEncoder().encode(trimmed).byteLength : 0;
  if (!trimmed || size < MINIMUM_SIGNING_SECRET_BYTES || size > MAXIMUM_SIGNING_SECRET_BYTES) {
    throw new APIError(500, "internal_error", "Artifact download signing is not configured", {
      hint: "Set OUTPUT_DOWNLOAD_SIGNING_SECRET to a distinct 32-byte-or-longer secret.",
      retriable: false,
    });
  }
  return trimmed;
}

async function signOutputDownload(input: {
  expires: number;
  outputId: string;
  secret: string;
  userId: UserIdType;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const payload = [
    "cheatcode-output-download-v2",
    input.userId,
    input.outputId,
    String(input.expires),
  ].join("\n");
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64Url(new Uint8Array(signature));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}
