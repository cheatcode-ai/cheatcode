import { hmacSha256Base64, timingSafeEqual } from "@cheatcode/auth";
import { APIError, redactSecrets } from "@cheatcode/observability";
import { z } from "zod";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const InternalAlertPayloadSchema = z
  .object({
    description: z.string().trim().min(1).max(4_000).optional(),
    id: z.string().trim().min(1).max(160).optional(),
    metadata: z.record(z.unknown()).optional(),
    metric: z.string().trim().min(1).max(160).optional(),
    route: z.string().trim().min(1).max(240).optional(),
    runId: z.string().trim().min(1).max(160).optional(),
    service: z.string().trim().min(1).max(160).optional(),
    severity: z.enum(["info", "warning", "critical"]).default("warning"),
    source: z.string().trim().min(1).max(160),
    threshold: z.string().trim().min(1).max(500).optional(),
    timestamp: z.string().trim().min(1).max(80).optional(),
    title: z.string().trim().min(1).max(240),
    userId: z.string().trim().min(1).max(160).optional(),
    window: z.string().trim().min(1).max(160).optional(),
    workerName: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export type InternalAlertPayload = z.infer<typeof InternalAlertPayloadSchema>;

export interface InternalAlertVerificationInput {
  rawBody: string;
  secret: string;
  signature: string | null;
  timestamp: string | null;
}

export interface VerifiedInternalAlert extends InternalAlertPayload {
  alertId: string;
}

export async function verifyInternalAlert(
  input: InternalAlertVerificationInput,
): Promise<VerifiedInternalAlert> {
  if (!input.timestamp || !input.signature) {
    throw invalidInternalAlertSignature("Missing internal alert signature headers");
  }
  assertFreshTimestamp(input.timestamp);

  const expected = await hmacSha256Base64(`${input.timestamp}.${input.rawBody}`, input.secret);
  if (!timingSafeEqual(signaturePayload(input.signature), expected)) {
    throw invalidInternalAlertSignature("Invalid internal alert signature");
  }

  const parsedJson = parseJson(input.rawBody);
  const payload = InternalAlertPayloadSchema.parse(redactSecrets(parsedJson));
  return {
    ...payload,
    alertId: payload.id ?? `alert_${crypto.randomUUID().replaceAll("-", "")}`,
  };
}

function invalidInternalAlertSignature(message: string): APIError {
  return new APIError(401, "auth_token_invalid", message, { retriable: false });
}

function assertFreshTimestamp(value: string): void {
  const rawTimestamp = Number(value);
  const timestampMs = rawTimestamp > 1_000_000_000_000 ? rawTimestamp : rawTimestamp * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    throw invalidInternalAlertSignature("Stale internal alert timestamp");
  }
}

function signaturePayload(signature: string): string {
  const parts = signature.split(",");
  return parts.length > 1 ? (parts[1] ?? "") : signature;
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new APIError(400, "invalid_request_body", "Internal alert body must be JSON", {
      retriable: false,
    });
  }
}
