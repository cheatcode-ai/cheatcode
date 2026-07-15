import { ComposioClient, isComposioNotFoundError } from "@cheatcode/composio";
import {
  type Database,
  deleteUserIntegrationAccount,
  deleteUserIntegrationAccounts,
  findUserIntegrationByConnectionId,
  listUserIntegrations,
  setDefaultUserIntegration,
  type UserIntegrationRecord,
  upsertUserIntegration,
  upsertUserIntegrations,
  withUserContext,
} from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError, createLogger, safeErrorTelemetry } from "@cheatcode/observability";
import {
  ComposioConnectionIdSchema,
  type Integration,
  type IntegrationAccount,
  IntegrationConnectResponseSchema,
  type IntegrationName,
  IntegrationNameSchema,
  IntegrationSchema,
  type UserId,
} from "@cheatcode/types";
import { z } from "zod";
import { resolveCorsOrigin } from "./cors";

export interface IntegrationEnv {
  CHEATCODE_ENVIRONMENT?: "development" | "production";
  COMPOSIO_API_KEY?: WorkerSecret;
  COMPOSIO_AUTH_CONFIGS?: WorkerSecret;
}

interface ConnectIntegrationInput {
  db: Database;
  env: IntegrationEnv;
  integration: IntegrationName;
  request: Request;
  userId: UserId;
}

interface IntegrationAccountInput {
  composioConnectionId: string;
  db: Database;
  integration: IntegrationName;
  userId: UserId;
}

type IntegrationAccountIdentity = Omit<IntegrationAccountInput, "db">;

interface DeleteIntegrationAccountInput extends IntegrationAccountInput {
  env: IntegrationEnv;
}

const CONNECTION_VISIBILITY_GRACE_MS = 15 * 60 * 1000;
const COMPOSIO_ACCOUNT_PAGE_SIZE = 100;
const COMPOSIO_ACCOUNT_MAX_PAGES = 10;
const COMPOSIO_ACCOUNT_MAX_ITEMS = COMPOSIO_ACCOUNT_PAGE_SIZE * COMPOSIO_ACCOUNT_MAX_PAGES;
const COMPOSIO_AUTH_CONFIG_PAGE_SIZE = 100;
const COMPOSIO_AUTH_CONFIG_MAX_PAGES = 10;
const COMPOSIO_REQUEST_TIMEOUT_MS = 30_000;
const COMPOSIO_AUTH_CONFIGS_MAX_CHARACTERS = 32 * 1024;

const SUPPORTED_INTEGRATIONS = [
  { displayName: "GitHub", name: "github" },
  { displayName: "Gmail", name: "gmail" },
  { displayName: "Slack", name: "slack" },
  { displayName: "Notion", name: "notion" },
  { displayName: "Linear", name: "linear" },
] as const satisfies readonly { displayName: string; name: IntegrationName }[];

const ComposioAuthConfigMapSchema = z.record(IntegrationNameSchema, z.string().min(1));

const ComposioConnectedAccountsSchema = z.object({
  items: z
    .array(
      z.object({
        alias: z.string().max(500).nullable().optional(),
        createdAt: z.string().datetime(),
        id: ComposioConnectionIdSchema,
        isDisabled: z.boolean(),
        status: z.string().max(100),
        toolkit: z.object({ slug: z.string().min(1).max(200) }),
        updatedAt: z.string().datetime(),
        wordId: z.string().max(500).nullable().optional(),
      }),
    )
    .max(COMPOSIO_ACCOUNT_PAGE_SIZE),
  nextCursor: z.string().max(2_000).nullish(),
});

type LiveConnectedAccount = z.infer<typeof ComposioConnectedAccountsSchema>["items"][number];

export function parseIntegrationName(name: string): IntegrationName {
  const parsed = IntegrationNameSchema.safeParse(name);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", "Unsupported integration", {
      details: { integration: name },
      retriable: false,
    });
  }
  return parsed.data;
}

export function parseComposioConnectionId(value: string): string {
  const parsed = ComposioConnectionIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", "Invalid connected account ID", {
      retriable: false,
    });
  }
  return parsed.data;
}

export async function listIntegrationSummaries(
  db: Database,
  env: IntegrationEnv,
  userId: UserId,
): Promise<Integration[]> {
  const accountsByToolkit = await listIntegrationAccounts(db, env, userId);
  const names = new Set<IntegrationName>(SUPPORTED_INTEGRATIONS.map(({ name }) => name));
  for (const name of accountsByToolkit.keys()) {
    names.add(name);
  }
  return [...names].map((name) => {
    const curated = SUPPORTED_INTEGRATIONS.find((entry) => entry.name === name);
    const accounts = accountsByToolkit.get(name) ?? [];
    return IntegrationSchema.parse({
      accounts,
      displayName: curated?.displayName ?? titleCaseSlug(name),
      name,
      status: aggregateStatus(accounts),
    });
  });
}

async function listIntegrationAccounts(
  db: Database,
  env: IntegrationEnv,
  userId: UserId,
): Promise<Map<IntegrationName, IntegrationAccount[]>> {
  const liveAccounts = await loadIntegrationAccountSnapshot(env, userId);
  return reconcileIntegrationAccountSnapshot(db, userId, liveAccounts);
}

/** Provider-only phase; callers may safely parallelize it with other external reads. */
export async function loadIntegrationAccountSnapshot(
  env: IntegrationEnv,
  userId: UserId,
): Promise<LiveConnectedAccount[]> {
  const liveAccounts = await listLiveAccounts(env, userId).catch((error: unknown) => {
    throw composioGatewayError("Unable to list connected accounts", error);
  });
  return liveAccounts;
}

/** Short RLS reconciliation phase; the provider snapshot must already be complete. */
export async function reconcileIntegrationAccountSnapshot(
  db: Database,
  userId: UserId,
  liveAccounts: readonly LiveConnectedAccount[],
): Promise<Map<IntegrationName, IntegrationAccount[]>> {
  return withUserContext(db, userId, (tx) =>
    reconcileIntegrationAccounts(tx, userId, liveAccounts),
  );
}

async function reconcileIntegrationAccounts(
  db: Database,
  userId: UserId,
  liveAccounts: readonly LiveConnectedAccount[],
): Promise<Map<IntegrationName, IntegrationAccount[]>> {
  const sortedLiveAccounts = [...liveAccounts].sort(
    (left, right) =>
      left.toolkit.slug.localeCompare(right.toolkit.slug) || left.id.localeCompare(right.id),
  );
  const liveRecords = sortedLiveAccounts.flatMap((account) => {
    const integration = IntegrationNameSchema.safeParse(account.toolkit.slug);
    return integration.success
      ? [
          {
            composioConnectionId: account.id,
            integration: integration.data,
            status: account.isDisabled ? "inactive" : account.status,
            userId,
          },
        ]
      : [];
  });
  await upsertUserIntegrations(db, liveRecords);
  const liveById = new Map(liveAccounts.map((account) => [account.id, account]));
  const records = await reconcileLocalIntegrationRecords(db, userId, liveById);
  const result = new Map<IntegrationName, IntegrationAccount[]>();
  for (const record of records) {
    const integration = IntegrationNameSchema.safeParse(record.integration);
    if (!integration.success) {
      continue;
    }
    const accounts = result.get(integration.data) ?? [];
    accounts.push(accountSummary(record, liveById.get(record.composioConnectionId)));
    result.set(integration.data, accounts);
  }
  return result;
}

async function reconcileLocalIntegrationRecords(
  db: Database,
  userId: UserId,
  liveById: ReadonlyMap<string, LiveConnectedAccount>,
): Promise<UserIntegrationRecord[]> {
  const records = await listUserIntegrations(db, userId);
  const stale = records.filter(
    (record) =>
      !liveById.has(record.composioConnectionId) &&
      Date.now() - record.connectedAt.getTime() >= CONNECTION_VISIBILITY_GRACE_MS,
  );
  await deleteUserIntegrationAccounts(db, userId, stale);
  return stale.length > 0 ? listUserIntegrations(db, userId) : records;
}

export async function connectIntegration(input: ConnectIntegrationInput): Promise<Response> {
  const composio = await createComposio(input.env);
  const authConfigId = await resolveAuthConfigId(composio, input.env, input.integration);
  const connection = await createConnectionLink({
    authConfigId,
    callbackUrl: resolveCallbackUrl(
      input.request,
      input.integration,
      input.env.CHEATCODE_ENVIRONMENT ?? "production",
    ),
    composio,
    integration: input.integration,
    userId: input.userId,
  });
  const response = await persistConnectionOrCompensate(input, composio, connection);
  return Response.json(response);
}

async function persistConnectionOrCompensate(
  input: ConnectIntegrationInput,
  composio: ComposioClient,
  connection: { id: string; redirectUrl: string },
) {
  try {
    const response = IntegrationConnectResponseSchema.parse({ oauthUrl: connection.redirectUrl });
    await withUserContext(input.db, input.userId, (tx) =>
      upsertUserIntegration(tx, {
        composioConnectionId: connection.id,
        integration: input.integration,
        status: "initiating",
        userId: input.userId,
      }),
    );
    return response;
  } catch (error) {
    await compensateFailedConnection(input, composio, connection.id);
    throw error;
  }
}

export async function deleteIntegrationAccount(
  input: DeleteIntegrationAccountInput,
): Promise<void> {
  const identity = integrationAccountIdentity(input);
  const record = await withUserContext(input.db, input.userId, (tx) =>
    requireAccountRecord(tx, identity),
  );
  const composio = await createComposio(input.env);
  await deleteConnectedAccount(composio, record.composioConnectionId);
  await withUserContext(input.db, input.userId, (tx) => deleteUserIntegrationAccount(tx, identity));
}

export async function makeIntegrationAccountDefault(input: IntegrationAccountInput): Promise<void> {
  const identity = integrationAccountIdentity(input);
  await withUserContext(input.db, input.userId, async (tx) => {
    await requireAccountRecord(tx, identity);
    const updated = await setDefaultUserIntegration(tx, identity);
    if (!updated) {
      throw new APIError(409, "conflict_state_invalid", "Only an active account can be default", {
        retriable: false,
      });
    }
  });
}

async function compensateFailedConnection(
  input: ConnectIntegrationInput,
  composio: ComposioClient,
  connectionId: string,
): Promise<void> {
  try {
    await deleteConnectedAccount(composio, connectionId);
  } catch (error) {
    createLogger({ userId: input.userId }).error("composio_connection_compensation_failed", {
      integration: input.integration,
      ...safeErrorTelemetry(error),
    });
  }
}

function accountSummary(
  record: UserIntegrationRecord,
  live: LiveConnectedAccount | undefined,
): IntegrationAccount {
  return {
    connectedAt: live?.createdAt ?? record.connectedAt.toISOString(),
    connectionId: record.composioConnectionId,
    isDefault: record.isDefault,
    label: `Account ${record.composioConnectionId.slice(0, 8)}`,
    status: normalizeIntegrationStatus(
      live ? (live.isDisabled ? "inactive" : live.status) : record.status,
    ),
    updatedAt: live?.updatedAt ?? record.updatedAt.toISOString(),
  };
}

function aggregateStatus(accounts: readonly IntegrationAccount[]): Integration["status"] {
  if (accounts.some((account) => account.status === "active")) {
    return "active";
  }
  return accounts[0]?.status ?? "not_connected";
}

function normalizeIntegrationStatus(status: string): Integration["status"] {
  switch (status.trim().toLowerCase()) {
    case "active":
    case "authorized":
    case "connected":
    case "enabled":
      return "active";
    case "failed":
      return "failed";
    case "inactive":
    case "revoked":
      return "inactive";
    case "expired":
      return "expired";
    case "initializing":
    case "initiated":
    case "initiating":
    case "pending":
      return "initiating";
    default:
      return "not_connected";
  }
}

async function listLiveAccounts(
  env: IntegrationEnv,
  userId: UserId,
): Promise<LiveConnectedAccount[]> {
  const composio = await createComposio(env);
  const accounts: LiveConnectedAccount[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pagesRead = 0;
  do {
    pagesRead += 1;
    if (pagesRead > COMPOSIO_ACCOUNT_MAX_PAGES) {
      throw composioAccountResultTooLarge();
    }
    const response = ComposioConnectedAccountsSchema.parse(
      await composio.listConnectedAccounts(
        {
          accountType: "PRIVATE",
          ...(cursor ? { cursor } : {}),
          limit: COMPOSIO_ACCOUNT_PAGE_SIZE,
          userIds: [userId],
        },
        COMPOSIO_REQUEST_TIMEOUT_MS,
      ),
    );
    if (accounts.length + response.items.length > COMPOSIO_ACCOUNT_MAX_ITEMS) {
      throw composioAccountResultTooLarge();
    }
    accounts.push(...response.items);
    cursor = response.nextCursor ?? null;
    if (cursor && seenCursors.has(cursor)) {
      throw new APIError(503, "upstream_provider_outage", "Composio pagination repeated a cursor", {
        retriable: true,
      });
    }
    if (cursor) {
      seenCursors.add(cursor);
    }
  } while (cursor);
  return accounts;
}

function composioAccountResultTooLarge(): APIError {
  return new APIError(502, "upstream_provider_outage", "Composio account result is too large", {
    hint: "Reduce the number of connected accounts before retrying.",
    retriable: false,
  });
}

async function resolveAuthConfigId(
  composio: ComposioClient,
  env: IntegrationEnv,
  integration: IntegrationName,
): Promise<string> {
  const configured = await readConfiguredAuthConfigId(env, integration);
  if (configured) {
    return configured;
  }
  try {
    const existingId = await findEnabledManagedAuthConfig(composio, integration);
    if (existingId) {
      return existingId;
    }
    return await composio.createManagedAuthConfig(
      integration,
      `${titleCaseSlug(integration)} Auth Config`,
      COMPOSIO_REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    throw composioGatewayError("Unable to prepare authentication", error, integration);
  }
}

async function findEnabledManagedAuthConfig(
  composio: ComposioClient,
  integration: IntegrationName,
): Promise<string | null> {
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < COMPOSIO_AUTH_CONFIG_MAX_PAGES; page += 1) {
    const response = await composio.listAuthConfigs(
      {
        ...(cursor ? { cursor } : {}),
        isComposioManaged: true,
        limit: COMPOSIO_AUTH_CONFIG_PAGE_SIZE,
        toolkit: integration,
      },
      COMPOSIO_REQUEST_TIMEOUT_MS,
    );
    const enabled = response.items.find((item) => item.status === "ENABLED");
    if (enabled) {
      return enabled.id;
    }
    cursor = response.nextCursor;
    if (!cursor) {
      return null;
    }
    if (seenCursors.has(cursor)) {
      throw new Error("Composio auth-config pagination repeated a cursor");
    }
    seenCursors.add(cursor);
  }
  throw new Error("Composio auth-config result exceeded the pagination boundary");
}

async function readConfiguredAuthConfigId(
  env: IntegrationEnv,
  integration: IntegrationName,
): Promise<string | undefined> {
  const raw = await resolveWorkerSecret(env.COMPOSIO_AUTH_CONFIGS).catch(() => undefined);
  if (!raw) {
    return undefined;
  }
  try {
    if (raw.length > COMPOSIO_AUTH_CONFIGS_MAX_CHARACTERS) {
      throw new RangeError("COMPOSIO_AUTH_CONFIGS is too large");
    }
    return ComposioAuthConfigMapSchema.parse(JSON.parse(raw) as unknown)[integration];
  } catch {
    throw new APIError(503, "unavailable_maintenance", "COMPOSIO_AUTH_CONFIGS is invalid", {
      hint: "Set COMPOSIO_AUTH_CONFIGS to a JSON object keyed by integration slug.",
      retriable: false,
    });
  }
}

async function createConnectionLink(input: {
  authConfigId: string;
  callbackUrl: string;
  composio: ComposioClient;
  integration: IntegrationName;
  userId: UserId;
}): Promise<{ id: string; redirectUrl: string }> {
  try {
    return await input.composio.createConnectionLink(
      {
        authConfigId: input.authConfigId,
        callbackUrl: input.callbackUrl,
        userId: input.userId,
      },
      COMPOSIO_REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    throw composioGatewayError("Unable to create Composio connection", error, input.integration);
  }
}

async function requireAccountRecord(
  db: Database,
  input: IntegrationAccountIdentity,
): Promise<UserIntegrationRecord> {
  const record = await findUserIntegrationByConnectionId(db, input);
  if (!record) {
    throw new APIError(404, "not_found_tool", "Connected account not found", {
      retriable: false,
    });
  }
  return record;
}

function integrationAccountIdentity(input: IntegrationAccountInput): IntegrationAccountIdentity {
  return {
    composioConnectionId: input.composioConnectionId,
    integration: input.integration,
    userId: input.userId,
  };
}

async function createComposio(env: IntegrationEnv): Promise<ComposioClient> {
  const apiKey = await readRequiredSecret(env.COMPOSIO_API_KEY, "COMPOSIO_API_KEY");
  return new ComposioClient(apiKey);
}

async function deleteConnectedAccount(
  composio: ComposioClient,
  connectionId: string,
): Promise<void> {
  try {
    await composio.deleteConnectedAccount(connectionId, COMPOSIO_REQUEST_TIMEOUT_MS);
  } catch (error) {
    if (isComposioNotFoundError(error)) {
      return;
    }
    throw composioGatewayError("Unable to disconnect account", error);
  }
}

async function readRequiredSecret(secret: WorkerSecret | undefined, name: string): Promise<string> {
  let value: string | undefined;
  try {
    value = await resolveWorkerSecret(secret);
  } catch {
    throw new APIError(503, "unavailable_maintenance", `${name} is unavailable`, {
      hint: `Verify the ${name} Cloudflare Secrets Store binding and secret value.`,
      retriable: false,
    });
  }
  if (!value) {
    throw new APIError(503, "unavailable_maintenance", `${name} is not configured`, {
      hint: `Set ${name} in the gateway Worker environment.`,
      retriable: false,
    });
  }
  return value;
}

function composioGatewayError(
  message: string,
  error: unknown,
  integration?: IntegrationName,
): APIError {
  return new APIError(503, "upstream_provider_outage", message, {
    details: {
      errorName: error instanceof Error ? error.name : typeof error,
      ...(integration ? { integration } : {}),
    },
    hint: "Check Composio API availability and the configured auth config IDs.",
    retriable: true,
  });
}

function resolveCallbackUrl(
  request: Request,
  integration: IntegrationName,
  environment: "development" | "production",
): string {
  const origin =
    trustedAppOrigin(request.headers.get("Origin"), environment) ??
    trustedAppOrigin(request.headers.get("Referer"), environment) ??
    "https://trycheatcode.com";
  const callback = new URL("/skills", origin);
  callback.searchParams.set("toolkit", integration);
  return callback.toString();
}

function trustedAppOrigin(
  value: string | null,
  environment: "development" | "production",
): string | null {
  if (!value) {
    return null;
  }
  try {
    const origin = new URL(value).origin;
    return resolveCorsOrigin(origin, environment) === origin ? origin : null;
  } catch {
    return null;
  }
}

function titleCaseSlug(slug: string): string {
  return slug
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
