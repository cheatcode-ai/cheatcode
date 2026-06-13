import type {
  ComposioConnectedAccounts,
  ComposioQuotaMeter,
  ComposioQuotaResult,
} from "@cheatcode/agent-core";
import {
  createDb,
  type DatabaseHandle,
  findEntitlementByUserId,
  listUserIntegrations,
  withUserContext,
} from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import type { createLogger } from "@cheatcode/observability";
import { IntegrationNameSchema, UserId } from "@cheatcode/types";
import { z } from "zod";
import { closeDatabaseBestEffort } from "./db-close";

interface ComposioProviderEnv {
  COMPOSIO_API_KEY?: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
  QUOTA_TRACKER?: DurableObjectNamespace;
}

interface ComposioProviderInput {
  userId: string;
}

interface ComposioQuotaConfig {
  limit: number;
  periodEnd: Date;
}

export interface ComposioRuntimeCredentials {
  composioApiKey?: string | undefined;
  composioConnectedAccounts?: ComposioConnectedAccounts | undefined;
  composioQuotaMeter?: ComposioQuotaMeter | undefined;
  composioUserId?: string | undefined;
}

const COMPOSIO_CALLS_FEATURE = "composio_calls";
const DEFAULT_COMPOSIO_CALL_LIMIT = 1000;

const QuotaConsumeResultSchema = z
  .object({
    allowed: z.boolean(),
    limit: z.number().finite().nonnegative(),
    remaining: z.number().finite().nonnegative(),
  })
  .strict();

export async function resolveComposioRuntimeCredentials(
  env: ComposioProviderEnv,
  input: ComposioProviderInput,
  logger: ReturnType<typeof createLogger>,
): Promise<ComposioRuntimeCredentials> {
  const apiKey = await readOptionalComposioApiKey(env, logger);
  const dbHandle = createDb(env.HYPERDRIVE);
  try {
    const userId = UserId(input.userId);
    const state = await withUserContext(dbHandle.db, userId, async (db) => {
      const [integrations, entitlement] = await Promise.all([
        listUserIntegrations(db, userId),
        findEntitlementByUserId(db, userId),
      ]);
      return {
        connectedAccounts: connectedAccountsFromRows(integrations),
        quota: {
          limit: entitlement?.quotaComposioCalls ?? DEFAULT_COMPOSIO_CALL_LIMIT,
          periodEnd: entitlement?.currentPeriodEnd ?? endOfCurrentUtcMonth(new Date()),
        },
      };
    });

    logger.info("composio_runtime_checked", {
      activeIntegrations: Object.keys(state.connectedAccounts).length,
      configured: Boolean(apiKey),
    });
    return {
      ...(apiKey ? { composioApiKey: apiKey } : {}),
      composioConnectedAccounts: state.connectedAccounts,
      composioQuotaMeter: quotaMeter(env, userId, state.quota),
      composioUserId: input.userId,
    };
  } finally {
    await closeDatabase(dbHandle, logger);
  }
}

function connectedAccountsFromRows(
  rows: Awaited<ReturnType<typeof listUserIntegrations>>,
): ComposioConnectedAccounts {
  const connectedAccounts: ComposioConnectedAccounts = {};
  for (const row of rows) {
    if (!isActiveIntegrationStatus(row.status)) {
      continue;
    }
    const parsedName = IntegrationNameSchema.safeParse(row.integration);
    if (parsedName.success) {
      connectedAccounts[parsedName.data] = row.composioConnectionId;
    }
  }
  return connectedAccounts;
}

function isActiveIntegrationStatus(status: string): boolean {
  return ["active", "authorized", "connected", "enabled"].includes(status.trim().toLowerCase());
}

async function readOptionalComposioApiKey(
  env: ComposioProviderEnv,
  logger: ReturnType<typeof createLogger>,
): Promise<string | undefined> {
  try {
    const apiKey = await resolveWorkerSecret(env.COMPOSIO_API_KEY);
    return apiKey?.trim() ? apiKey : undefined;
  } catch (error) {
    logger.warn("composio_api_key_unavailable", {
      error: error instanceof Error ? error.message : "Unknown secret resolution error",
    });
    return undefined;
  }
}

function quotaMeter(
  env: ComposioProviderEnv,
  userId: UserId,
  quota: ComposioQuotaConfig,
): ComposioQuotaMeter | undefined {
  const namespace = env.QUOTA_TRACKER;
  if (!namespace) {
    return undefined;
  }
  return {
    consumeCall: () => consumeComposioQuota(namespace, userId, quota),
  };
}

async function consumeComposioQuota(
  namespace: DurableObjectNamespace,
  userId: UserId,
  quota: ComposioQuotaConfig,
): Promise<ComposioQuotaResult> {
  const stub = namespace.get(namespace.idFromName(`quota:${userId}`));
  await requireQuotaResponse(
    stub.fetch("https://quota.internal/set-limit", {
      body: JSON.stringify({
        feature: COMPOSIO_CALLS_FEATURE,
        limit: quota.limit,
        source: "agent-worker-entitlement",
      }),
      method: "POST",
    }),
  );
  const response = await requireQuotaResponse(
    stub.fetch("https://quota.internal/try-consume", {
      body: JSON.stringify({
        amount: 1,
        feature: COMPOSIO_CALLS_FEATURE,
        periodEnd: quota.periodEnd.toISOString(),
      }),
      method: "POST",
    }),
  );
  return QuotaConsumeResultSchema.parse(await response.json());
}

async function requireQuotaResponse(responsePromise: Promise<Response>): Promise<Response> {
  const response = await responsePromise;
  if (!response.ok) {
    throw new Error("Quota tracker rejected Composio call metering.");
  }
  return response;
}

function endOfCurrentUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1);
}

async function closeDatabase(
  dbHandle: DatabaseHandle,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  await closeDatabaseBestEffort({ dbHandle, logger, operation: "resolve_composio_credentials" });
}
