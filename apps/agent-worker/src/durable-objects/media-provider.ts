import { getProviderKey } from "@cheatcode/byok";
import { withUserDb } from "@cheatcode/db";
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
  return withUserDb(
    env,
    UserId(input.userId),
    async ({ transaction }) => {
      const googleMediaApiKey = await transaction((db) => getProviderKey(db, "google"));
      logger.info("byok_media_provider_key_checked", { google: Boolean(googleMediaApiKey) });
      return googleMediaApiKey ? { googleMediaApiKey } : {};
    },
    (dbHandle) =>
      closeDatabaseBestEffort({
        dbHandle,
        logger,
        operation: "resolve_media_credentials",
      }),
  );
}
