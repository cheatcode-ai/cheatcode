import { getProviderKey } from "@cheatcode/byok";
import { createDb, type DatabaseHandle, withUserContext } from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import type { createLogger } from "@cheatcode/observability";
import { UserId } from "@cheatcode/types";
import { closeDatabaseBestEffort } from "./db-close";

interface ResearchProviderEnv {
  DATABASE_CONTEXT_SIGNING_SECRET_AGENT: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
}

interface ResearchProviderInput {
  userId: string;
}

export interface ResearchCredentials {
  exaApiKey?: string | undefined;
  firecrawlApiKey?: string | undefined;
}

export async function resolveResearchCredentials(
  env: ResearchProviderEnv,
  input: ResearchProviderInput,
  logger: ReturnType<typeof createLogger>,
): Promise<ResearchCredentials> {
  const dbHandle = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const credentials = await withUserContext(dbHandle.db, UserId(input.userId), async (db) => {
      const exaApiKey = await getProviderKey(db, "exa");
      const firecrawlApiKey = await getProviderKey(db, "firecrawl");
      return credentialSet({ exaApiKey, firecrawlApiKey });
    });

    logger.info("byok_research_provider_keys_checked", {
      exa: Boolean(credentials.exaApiKey),
      firecrawl: Boolean(credentials.firecrawlApiKey),
    });
    return credentials;
  } finally {
    await closeDatabase(dbHandle, logger);
  }
}

function credentialSet(input: {
  exaApiKey: string | null;
  firecrawlApiKey: string | null;
}): ResearchCredentials {
  const credentials: ResearchCredentials = {};
  if (input.exaApiKey) {
    credentials.exaApiKey = input.exaApiKey;
  }
  if (input.firecrawlApiKey) {
    credentials.firecrawlApiKey = input.firecrawlApiKey;
  }
  return credentials;
}

async function closeDatabase(
  dbHandle: DatabaseHandle,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  await closeDatabaseBestEffort({ dbHandle, logger, operation: "resolve_research_credentials" });
}
