import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import type { UserId } from "@cheatcode/types";

export type DatabaseRuntimeAudience = "app_agent" | "app_gateway" | "app_webhooks";

export interface DatabaseContextConfig {
  audience: DatabaseRuntimeAudience;
  signingSecret: WorkerSecret;
}

export interface SignedDatabaseContext {
  issuedAt: string;
  nonce: string;
  signature: string;
  userId: UserId;
}

interface DatabaseContextSigner {
  sign(userId: UserId): Promise<SignedDatabaseContext>;
}

const CONTEXT_DOMAIN = "cheatcode-database-context-v1";
const MINIMUM_SECRET_BYTES = 32;

export function createDatabaseContextSigner(config: DatabaseContextConfig): DatabaseContextSigner {
  let keyPromise: ReturnType<typeof crypto.subtle.importKey> | undefined;
  const key = () => {
    keyPromise ??= importSigningKey(config.signingSecret);
    return keyPromise;
  };
  return {
    async sign(userId) {
      const issuedAt = String(Date.now());
      const nonce = crypto.randomUUID();
      const payload = contextPayload(config.audience, userId, issuedAt, nonce);
      const signature = await crypto.subtle.sign(
        "HMAC",
        await key(),
        new TextEncoder().encode(payload),
      );
      return { issuedAt, nonce, signature: bytesToHex(signature), userId };
    },
  };
}

function contextPayload(
  audience: DatabaseRuntimeAudience,
  userId: UserId,
  issuedAt: string,
  nonce: string,
): string {
  return [CONTEXT_DOMAIN, audience, userId, issuedAt, nonce].join("\n");
}

async function importSigningKey(
  secretBinding: WorkerSecret,
): ReturnType<typeof crypto.subtle.importKey> {
  const secret = await resolveWorkerSecret(secretBinding);
  if (!secret || new TextEncoder().encode(secret).byteLength < MINIMUM_SECRET_BYTES) {
    throw new Error("Database context signing secret must contain at least 32 bytes");
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
}

function bytesToHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
