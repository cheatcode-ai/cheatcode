import { APIError } from "@cheatcode/observability";
import { z } from "zod";

const DEFAULT_OUTPUT_DOWNLOAD_BASE_URL = "https://gateway.trycheatcode.com";
const OUTPUT_DOWNLOAD_TTL_SECONDS = 60 * 60;

export const OutputIdSchema = z.string().uuid();

export const OutputDownloadQuerySchema = z
  .object({
    expires: z.coerce.number().int().positive(),
    sig: z.string().min(32).max(256),
  })
  .strict();

export interface CreateSignedOutputDownloadUrlInput {
  baseUrl?: string | undefined;
  outputId: string;
  secret: string | undefined;
}

export interface VerifySignedOutputDownloadInput {
  expires: number;
  nowSeconds?: number;
  outputId: string;
  secret: string | undefined;
  signature: string;
}

export async function createSignedOutputDownloadUrl(
  input: CreateSignedOutputDownloadUrlInput,
): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + OUTPUT_DOWNLOAD_TTL_SECONDS;
  const signature = await signOutputDownload({
    expires,
    outputId: input.outputId,
    secret: requiredSigningSecret(input.secret),
  });
  const url = new URL(
    `/v1/outputs/${input.outputId}/download`,
    normalizeOutputDownloadBaseUrl(input.baseUrl),
  );
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("sig", signature);
  return url.toString();
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
  if (!trimmed) {
    throw new APIError(500, "internal_error", "Artifact download signing is not configured", {
      hint: "Set OUTPUT_DOWNLOAD_SIGNING_SECRET on cheatcode-agent.",
      retriable: false,
    });
  }
  return trimmed;
}

async function signOutputDownload(input: {
  expires: number;
  outputId: string;
  secret: string;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const payload = `${input.outputId}.${input.expires}`;
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
