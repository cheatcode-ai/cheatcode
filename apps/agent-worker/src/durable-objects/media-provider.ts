import { getProviderKey } from "@cheatcode/byok";
import { withUserDb } from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import type { createLogger } from "@cheatcode/observability";
import { toUserId } from "@cheatcode/types";
import { closeDatabaseBestEffort } from "./db-close";

interface MediaProviderEnv {
  DATABASE_CONTEXT_SIGNING_SECRET_AGENT: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
}

interface GoogleToolProviderInput {
  userId: string;
}

export type GoogleToolApiKeyResolver = () => Promise<string | undefined>;

export function createGoogleToolApiKeyResolver(
  env: MediaProviderEnv,
  input: GoogleToolProviderInput,
  logger: ReturnType<typeof createLogger>,
): GoogleToolApiKeyResolver {
  let resolution: Promise<string | undefined> | undefined;
  return () => {
    resolution ??= resolveGoogleToolApiKey(env, input, logger);
    return resolution;
  };
}

async function resolveGoogleToolApiKey(
  env: MediaProviderEnv,
  input: GoogleToolProviderInput,
  logger: ReturnType<typeof createLogger>,
): Promise<string | undefined> {
  return withUserDb(
    env,
    toUserId(input.userId),
    async ({ transaction }) => {
      const googleMediaApiKey = await transaction((db) => getProviderKey(db, "google"));
      logger.info("byok_google_tool_key_checked", { configured: Boolean(googleMediaApiKey) });
      return googleMediaApiKey ?? undefined;
    },
    (dbHandle) =>
      closeDatabaseBestEffort({
        dbHandle,
        logger,
        operation: "resolve_google_tool_key",
      }),
  );
}
