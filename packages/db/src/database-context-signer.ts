export type DatabaseContextAudience = "app_agent" | "app_gateway" | "app_webhooks";

interface RawSignedDatabaseContext {
  issuedAt: string;
  nonce: string;
  signature: string;
  userId: string;
}

interface RawDatabaseContextSigner {
  sign(userId: string): Promise<RawSignedDatabaseContext>;
}

const CONTEXT_DOMAIN = "cheatcode-database-context-v1";
const MINIMUM_SECRET_BYTES = 32;

export function createRawDatabaseContextSigner(config: {
  audience: DatabaseContextAudience;
  loadSecret: () => Promise<string | undefined>;
}): RawDatabaseContextSigner {
  let keyPromise: ReturnType<typeof crypto.subtle.importKey> | undefined;
  const key = () => {
    keyPromise ??= importSigningKey(config.loadSecret);
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
  audience: DatabaseContextAudience,
  userId: string,
  issuedAt: string,
  nonce: string,
): string {
  return [CONTEXT_DOMAIN, audience, userId, issuedAt, nonce].join("\n");
}

async function importSigningKey(
  loadSecret: () => Promise<string | undefined>,
): ReturnType<typeof crypto.subtle.importKey> {
  const secret = await loadSecret();
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
