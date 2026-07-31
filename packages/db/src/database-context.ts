import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import type { UserId } from "@cheatcode/types";
import {
  createRawDatabaseContextSigner,
  type DatabaseContextAudience,
} from "./database-context-signer";

export interface DatabaseContextConfig {
  audience: DatabaseContextAudience;
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

export function createDatabaseContextSigner(config: DatabaseContextConfig): DatabaseContextSigner {
  const signer = createRawDatabaseContextSigner({
    audience: config.audience,
    loadSecret: () => resolveWorkerSecret(config.signingSecret),
  });
  return {
    async sign(userId) {
      const signed = await signer.sign(userId);
      return { ...signed, userId };
    },
  };
}
