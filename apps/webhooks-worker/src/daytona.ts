import { z } from "zod";

/**
 * Daytona `sandbox.state.updated` webhook payload. `id` is the sandbox UUID,
 * `newState` the new lifecycle state (e.g. "STARTED", "STOPPED"). Extra fields are tolerated.
 */
export const DaytonaWebhookSchema = z
  .object({
    event: z.literal("sandbox.state.updated"),
    id: z.string().uuid(),
    newState: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z_]+$/),
    oldState: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z_]+$/)
      .optional(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .passthrough();

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const MAX_SIGNATURE_HEADER_LENGTH = 2_048;
const MAX_MESSAGE_ID_LENGTH = 256;

interface VerifiedDaytonaWebhookEnvelope {
  eventId: string;
}

/** Verify the Svix envelope used by Daytona and return its signed replay-protection identity. */
export async function verifyDaytonaWebhook(
  secret: string,
  rawBody: string,
  headers: Headers,
): Promise<VerifiedDaytonaWebhookEnvelope | null> {
  const messageId = webhookHeader(headers, "id");
  const timestamp = webhookHeader(headers, "timestamp");
  const signature = webhookHeader(headers, "signature");
  if (
    !messageId ||
    messageId.length > MAX_MESSAGE_ID_LENGTH ||
    !timestamp ||
    !signature ||
    signature.length > MAX_SIGNATURE_HEADER_LENGTH ||
    !isFreshWebhookTimestamp(timestamp)
  ) {
    return null;
  }

  const secretBytes = decodeSigningSecret(secret);
  if (!secretBytes) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"],
  );
  const signedContent = new TextEncoder().encode(`${messageId}.${timestamp}.${rawBody}`);
  for (const candidate of signature.split(/\s+/u)) {
    const encoded = candidate.startsWith("v1,") ? candidate.slice(3) : "";
    const signatureBytes = decodeBase64(encoded);
    if (
      signatureBytes &&
      (await crypto.subtle.verify("HMAC", key, signatureBytes, signedContent))
    ) {
      return { eventId: messageId };
    }
  }
  return null;
}

function webhookHeader(headers: Headers, suffix: "id" | "signature" | "timestamp"): string | null {
  return headers.get(`webhook-${suffix}`) ?? headers.get(`svix-${suffix}`);
}

function isFreshWebhookTimestamp(value: string): boolean {
  if (!/^\d{10}$/u.test(value)) return false;
  const timestamp = Number(value);
  return (
    Number.isSafeInteger(timestamp) &&
    Math.abs(Math.floor(Date.now() / 1_000) - timestamp) <= WEBHOOK_TOLERANCE_SECONDS
  );
}

function decodeSigningSecret(secret: string): Uint8Array<ArrayBuffer> | null {
  const encoded = secret.startsWith("whsec_") ? secret.slice(6) : "";
  return decodeBase64(encoded);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  if (!value || value.length > 1_024) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
