const TEXT_ENCODER = new TextEncoder();
export const MINIMUM_HMAC_SECRET_UTF8_BYTES = 32;

/** Reject HMAC keys that do not meet the platform's minimum cryptographic key size. */
export function assertHmacSecretStrength(secret: string): void {
  if (TEXT_ENCODER.encode(secret).byteLength < MINIMUM_HMAC_SECRET_UTF8_BYTES) {
    throw new TypeError("HMAC secret must contain at least 32 UTF-8 bytes");
  }
}

/** Reject capability sets whose keys would collapse otherwise isolated trust boundaries. */
export function assertDistinctHmacSecrets(secrets: readonly string[]): void {
  for (const secret of secrets) {
    assertHmacSecretStrength(secret);
  }
  if (new Set(secrets).size !== secrets.length) {
    throw new TypeError("HMAC capability secrets must be distinct");
  }
}

export async function hmacSha256Base64(message: string, secret: string): Promise<string> {
  return base64FromBytes(await hmacSha256(message, secret));
}

export async function hmacSha256Base64Url(message: string, secret: string): Promise<string> {
  return base64UrlFromBytes(await hmacSha256(message, secret));
}

export async function sha256Base64Url(message: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(message));
  return base64UrlFromBytes(new Uint8Array(digest));
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

async function hmacSha256(message: string, secret: string): Promise<Uint8Array> {
  assertHmacSecretStrength(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, TEXT_ENCODER.encode(message));
  return new Uint8Array(signature);
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  return base64FromBytes(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
