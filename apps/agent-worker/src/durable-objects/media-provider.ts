import { getProviderKey } from "@cheatcode/byok";
import { createDb, type DatabaseHandle, withUserContext } from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import type { createLogger } from "@cheatcode/observability";
import { UserId } from "@cheatcode/types";
import { closeDatabaseBestEffort } from "./db-close";

interface MediaProviderEnv {
  DATABASE_CONTEXT_SIGNING_SECRET_AGENT: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
}

interface MediaProviderInput {
  userId: string;
}

export interface MediaCredentials {
  googleMediaApiKey?: string | undefined;
}

export async function resolveMediaCredentials(
  env: MediaProviderEnv,
  input: MediaProviderInput,
  logger: ReturnType<typeof createLogger>,
): Promise<MediaCredentials> {
  const dbHandle = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const googleMediaApiKey = await withUserContext(dbHandle.db, UserId(input.userId), (db) =>
      getProviderKey(db, "google"),
    );
    logger.info("byok_media_provider_key_checked", { google: Boolean(googleMediaApiKey) });
    return googleMediaApiKey ? { googleMediaApiKey } : {};
  } finally {
    await closeMediaDatabase(dbHandle, logger);
  }
}

async function closeMediaDatabase(
  dbHandle: DatabaseHandle,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  await closeDatabaseBestEffort({ dbHandle, logger, operation: "resolve_media_credentials" });
}
