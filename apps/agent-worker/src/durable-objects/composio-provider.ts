import type {
  ComposioConnectedAccounts,
  ComposioQuotaMeter,
  ComposioQuotaResult,
} from "@cheatcode/agent-core";
import { entitlementCacheFromValues, quotaPeriodEndFor } from "@cheatcode/billing";
import {
  createDb,
  type DatabaseHandle,
  findEntitlementByUserId,
  listUserIntegrations,
  withUserContext,
} from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { type createLogger, readBoundedResponseJson } from "@cheatcode/observability";
import { IntegrationNameSchema, UserId } from "@cheatcode/types";
import {
  QUOTA_FEATURES,
  QUOTA_TRACKER_MAX_RESPONSE_BYTES,
  QuotaSetLimitRequestSchema,
  QuotaSetLimitResponseSchema,
  QuotaTryConsumeRequestSchema,
  QuotaTryConsumeResponseSchema,
} from "@cheatcode/types/quota";
import { closeDatabaseBestEffort } from "./db-close";

interface ComposioProviderEnv {
  COMPOSIO_API_KEY?: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
  QUOTA_TRACKER: DurableObjectNamespace;
}

interface ComposioProviderInput {
  userId: string;
}

interface ComposioQuotaConfig {
  entitlementVersion: number;
  limit: number;
  periodEnd: Date;
}

export interface ComposioRuntimeCredentials {
  composioApiKey?: string | undefined;
  composioConnectedAccounts?: ComposioConnectedAccounts | undefined;
  composioQuotaMeter?: ComposioQuotaMeter | undefined;
  composioUserId?: string | undefined;
}

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
      // A user-context transaction owns one pg client. Keep its queries sequential instead of
      // pretending to parallelize them through the same connection.
      const integrations = await listUserIntegrations(db, userId);
      const entitlement = await findEntitlementByUserId(db, userId);
      const resolvedEntitlement = entitlementCacheFromValues(entitlement ?? { tier: "free" });
      return {
        connectedAccounts: connectedAccountsFromRows(integrations),
        quota: {
          entitlementVersion: Date.parse(resolvedEntitlement.updatedAt),
          limit: resolvedEntitlement.quotaComposioCalls,
          periodEnd: quotaPeriodEndFor(resolvedEntitlement),
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
    if (parsedName.success && (row.isDefault || connectedAccounts[parsedName.data] === undefined)) {
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
      error,
    });
    return undefined;
  }
}

function quotaMeter(
  env: ComposioProviderEnv,
  userId: UserId,
  quota: ComposioQuotaConfig,
): ComposioQuotaMeter {
  return {
    consumeCall: (eventId) => consumeComposioQuota(env.QUOTA_TRACKER, userId, quota, eventId),
  };
}

async function consumeComposioQuota(
  namespace: DurableObjectNamespace,
  userId: UserId,
  quota: ComposioQuotaConfig,
  eventId: string,
): Promise<ComposioQuotaResult> {
  const stub = namespace.get(namespace.idFromName(`quota:${userId}`));
  const limitBody = QuotaSetLimitRequestSchema.parse({
    entitlementVersion: quota.entitlementVersion,
    feature: QUOTA_FEATURES.composioCalls,
    limit: quota.limit,
  });
  const limitResponse = await requireQuotaResponse(
    stub.fetch("https://quota.internal/set-limit", {
      body: JSON.stringify(limitBody),
      method: "POST",
    }),
  );
  QuotaSetLimitResponseSchema.parse(
    await readBoundedResponseJson(
      limitResponse,
      QUOTA_TRACKER_MAX_RESPONSE_BYTES,
      "Quota set-limit",
    ),
  );
  const consumeBody = QuotaTryConsumeRequestSchema.parse({
    amount: 1,
    eventId,
    feature: QUOTA_FEATURES.composioCalls,
    periodEnd: quota.periodEnd.toISOString(),
  });
  const response = await requireQuotaResponse(
    stub.fetch("https://quota.internal/try-consume", {
      body: JSON.stringify(consumeBody),
      method: "POST",
    }),
  );
  return QuotaTryConsumeResponseSchema.parse(
    await readBoundedResponseJson(response, QUOTA_TRACKER_MAX_RESPONSE_BYTES, "Quota tracker"),
  );
}

async function requireQuotaResponse(responsePromise: Promise<Response>): Promise<Response> {
  const response = await responsePromise;
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Quota tracker rejected Composio call metering.");
  }
  return response;
}

async function closeDatabase(
  dbHandle: DatabaseHandle,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  await closeDatabaseBestEffort({ dbHandle, logger, operation: "resolve_composio_credentials" });
}
