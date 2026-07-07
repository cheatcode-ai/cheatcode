import { z } from "zod";

/**
 * Daytona `sandbox.state.updated` (and sibling) webhook payloads. `id` is the sandbox UUID,
 * `newState` the new lifecycle state (e.g. "STARTED", "STOPPED"). Extra fields are tolerated.
 */
export const DaytonaWebhookSchema = z
  .object({
    event: z.string().optional(),
    id: z.string().optional(),
    newState: z.string().optional(),
    oldState: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();
export type DaytonaWebhookEvent = z.infer<typeof DaytonaWebhookSchema>;

// KV key + TTL for the sandbox-state cache read by the preview-status endpoint.
export const sandboxStateCacheKey = (sandboxId: string): string => `sbx:${sandboxId}`;
const SANDBOX_STATE_TTL_S = 24 * 60 * 60;

/**
 * Verify a Daytona webhook. The sandbox-state cache is only a UI hint — the wake path calls
 * Daytona directly — so verification degrades gracefully: with no secret configured we accept
 * (the preview-status endpoint's live-read fallback keeps state correct); with a secret we require
 * an HMAC-SHA256 (over the raw body) match against the `X-Signature` header.
 */
export async function verifyDaytonaWebhook(
  secret: string | null,
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!secret) {
    return true;
  }
  if (!signature) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  const b64 = btoa(String.fromCharCode(...mac));
  const provided = signature.replace(/^v1[,=]/i, "").trim();
  return timingSafeEqual(provided, hex) || timingSafeEqual(provided, b64);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Cache the new sandbox lifecycle state (lowercased to match Daytona's REST API + the DO), keyed
 * by sandbox UUID, so the preview-status endpoint can answer without polling Daytona. No-op when
 * the cache is unbound or the payload lacks an id/state.
 */
export async function cacheSandboxState(
  kv: KVNamespace | undefined,
  event: DaytonaWebhookEvent,
  nowIso: string,
): Promise<void> {
  if (!kv || !event.id || !event.newState) {
    return;
  }
  await kv.put(
    sandboxStateCacheKey(event.id),
    JSON.stringify({ state: event.newState.toLowerCase(), updatedAt: event.updatedAt ?? nowIso }),
    { expirationTtl: SANDBOX_STATE_TTL_S },
  );
}
