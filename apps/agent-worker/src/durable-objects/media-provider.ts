import { getProviderKey } from "@cheatcode/byok";
import { createDb, type DatabaseHandle, withUserContext } from "@cheatcode/db";
import type { createLogger } from "@cheatcode/observability";
import { UserId } from "@cheatcode/types";
import { closeDatabaseBestEffort } from "./db-close";

interface MediaProviderEnv {
  HYPERDRIVE: Hyperdrive;
}

interface MediaProviderInput {
  userId: string;
}

export interface MediaCredentials {
  elevenlabsApiKey?: string | undefined;
  falApiKey?: string | undefined;
}

export async function resolveMediaCredentials(
  env: MediaProviderEnv,
  input: MediaProviderInput,
  logger: ReturnType<typeof createLogger>,
): Promise<MediaCredentials> {
  const dbHandle = createDb(env.HYPERDRIVE);
  try {
    const credentials = await withUserContext(dbHandle.db, UserId(input.userId), async (db) => {
      const falApiKey = await getProviderKey(db, "fal");
      const elevenlabsApiKey = await getProviderKey(db, "elevenlabs");
      return credentialSet({ elevenlabsApiKey, falApiKey });
    });

    logger.info("byok_media_provider_keys_checked", {
      elevenlabs: Boolean(credentials.elevenlabsApiKey),
      fal: Boolean(credentials.falApiKey),
    });
    return credentials;
  } finally {
    await closeDatabase(dbHandle, logger);
  }
}

function credentialSet(input: {
  elevenlabsApiKey: string | null;
  falApiKey: string | null;
}): MediaCredentials {
  const credentials: MediaCredentials = {};
  if (input.falApiKey) {
    credentials.falApiKey = input.falApiKey;
  }
  if (input.elevenlabsApiKey) {
    credentials.elevenlabsApiKey = input.elevenlabsApiKey;
  }
  return credentials;
}

async function closeDatabase(
  dbHandle: DatabaseHandle,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  await closeDatabaseBestEffort({ dbHandle, logger, operation: "resolve_media_credentials" });
}
