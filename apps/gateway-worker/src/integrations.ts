import {
  type Database,
  deleteUserIntegration,
  findUserIntegration,
  listUserIntegrations,
  type UserIntegrationRecord,
  upsertUserIntegration,
} from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import {
  type Integration,
  IntegrationConnectResponseSchema,
  type IntegrationName,
  IntegrationNameSchema,
  IntegrationSchema,
  type UserId,
} from "@cheatcode/types";
import { Composio } from "@composio/core";
import { z } from "zod";

export interface IntegrationEnv {
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

interface DeleteIntegrationInput {
  db: Database;
  env: IntegrationEnv;
  integration: IntegrationName;
  userId: UserId;
}

const SUPPORTED_INTEGRATIONS = [
  { displayName: "GitHub", name: "github" },
  { displayName: "Gmail", name: "gmail" },
  { displayName: "Slack", name: "slack" },
  { displayName: "Notion", name: "notion" },
  { displayName: "Linear", name: "linear" },
] as const satisfies readonly { displayName: string; name: IntegrationName }[];

// Optional override map of toolkit slug -> a specific (often custom-credentialed)
// Composio auth config id. Toolkits not listed fall back to a Composio-managed auth
// config created on demand, so any catalog toolkit can be connected.
const ComposioAuthConfigMapSchema = z.record(IntegrationNameSchema, z.string().min(1));

type ComposioAuthConfigMap = z.infer<typeof ComposioAuthConfigMapSchema>;

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

export async function listIntegrationSummaries(
  db: Database,
  userId: UserId,
): Promise<Integration[]> {
  const records = await listUserIntegrations(db, userId);
  const byName = new Map<IntegrationName, UserIntegrationRecord>();
  for (const record of records) {
    const parsed = IntegrationNameSchema.safeParse(record.integration);
    if (parsed.success) {
      byName.set(parsed.data, record);
    }
  }
  const supportedNames = new Set<string>(SUPPORTED_INTEGRATIONS.map((supported) => supported.name));
  const summaries = SUPPORTED_INTEGRATIONS.map((supported) =>
    integrationSummary(supported.name, supported.displayName, byName.get(supported.name)),
  );
  // Include any app connected outside the curated five (e.g. from the full Composio
  // catalog on the Tools page) so the connected-state reflects reality everywhere.
  for (const [name, record] of byName) {
    if (!supportedNames.has(name)) {
      summaries.push(integrationSummary(name, titleCaseSlug(name), record));
    }
  }
  return summaries;
}

/** "google_calendar" -> "Google Calendar" for catalog apps without a curated display name. */
function titleCaseSlug(slug: string): string {
  return slug
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function connectIntegration(input: ConnectIntegrationInput): Promise<Response> {
  const apiKey = await readRequiredSecret(input.env.COMPOSIO_API_KEY, "COMPOSIO_API_KEY");
  const composio = new Composio({
    allowTracking: false,
    apiKey,
    baseURL: "https://backend.composio.dev",
  });
  const connection = await createConnection(input, composio);
  await upsertUserIntegration(input.db, {
    composioConnectionId: connection.id,
    integration: input.integration,
    status: "initiating",
    userId: input.userId,
  });
  return Response.json(
    IntegrationConnectResponseSchema.parse({ oauthUrl: connection.redirectUrl }),
  );
}

export async function deleteIntegration(input: DeleteIntegrationInput): Promise<void> {
  const record = await findUserIntegration(input.db, {
    integration: input.integration,
    userId: input.userId,
  });
  if (!record) {
    return;
  }
  const apiKey = await readRequiredSecret(input.env.COMPOSIO_API_KEY, "COMPOSIO_API_KEY");
  const composio = new Composio({
    allowTracking: false,
    apiKey,
    baseURL: "https://backend.composio.dev",
  });
  await deleteConnectedAccount(composio, record.composioConnectionId);
  await deleteUserIntegration(input.db, {
    integration: input.integration,
    userId: input.userId,
  });
}

function integrationSummary(
  name: IntegrationName,
  displayName: string,
  record: UserIntegrationRecord | undefined,
): Integration {
  return IntegrationSchema.parse({
    connectedAt: record?.connectedAt.toISOString() ?? null,
    connectionId: record?.composioConnectionId ?? null,
    displayName,
    name,
    status: record ? normalizeIntegrationStatus(record.status) : "not_connected",
    updatedAt: record?.updatedAt.toISOString() ?? null,
  });
}

export function normalizeIntegrationStatus(status: string): Integration["status"] {
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
    case "initiated":
    case "initiating":
    case "pending":
      return "initiating";
    default:
      return "not_connected";
  }
}

// Builds a Composio connection link. Curated toolkits with a pre-configured auth
// config keep the redirect-back-to-Cheatcode flow; every other toolkit uses
// toolkits.authorize, which creates the right auth-config type for that toolkit's
// auth scheme (OAuth, API key, etc.) and initiates the connection idempotently.
async function createConnection(
  input: ConnectIntegrationInput,
  composio: Composio,
): Promise<{ id: string; redirectUrl: string }> {
  const configured = await readConfiguredAuthConfigId(input.env, input.integration);
  if (configured) {
    return createConnectionLink({
      authConfigId: configured,
      callbackUrl: resolveCallbackUrl(input.request),
      composio,
      integration: input.integration,
      userId: input.userId,
    });
  }
  return authorizeToolkit(composio, input.integration, input.userId);
}

async function authorizeToolkit(
  composio: Composio,
  integration: IntegrationName,
  userId: UserId,
): Promise<{ id: string; redirectUrl: string }> {
  try {
    const connection = await composio.toolkits.authorize(userId, integration);
    if (!connection.redirectUrl) {
      throw new Error("Composio returned no redirect URL.");
    }
    return { id: connection.id, redirectUrl: connection.redirectUrl };
  } catch (error) {
    throw composioGatewayError("Unable to start the connection", error, integration);
  }
}

async function readConfiguredAuthConfigId(
  env: IntegrationEnv,
  integration: IntegrationName,
): Promise<string | undefined> {
  const raw = await resolveWorkerSecret(env.COMPOSIO_AUTH_CONFIGS).catch(() => undefined);
  if (!raw) {
    return undefined;
  }
  return parseAuthConfigJson(raw)[integration];
}

function parseAuthConfigJson(raw: string): ComposioAuthConfigMap {
  try {
    return ComposioAuthConfigMapSchema.parse(JSON.parse(raw) as unknown);
  } catch {
    throw new APIError(503, "unavailable_maintenance", "COMPOSIO_AUTH_CONFIGS is invalid", {
      hint: "Set COMPOSIO_AUTH_CONFIGS to a JSON object keyed by integration slug.",
      retriable: false,
    });
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

async function createConnectionLink(input: {
  authConfigId: string;
  callbackUrl: string;
  composio: Composio;
  integration: IntegrationName;
  userId: UserId;
}) {
  try {
    const connection = await input.composio.connectedAccounts.link(
      input.userId,
      input.authConfigId,
      {
        callbackUrl: input.callbackUrl,
      },
    );
    if (!connection.redirectUrl) {
      throw new Error("Composio returned no redirect URL.");
    }
    return { id: connection.id, redirectUrl: connection.redirectUrl };
  } catch (error) {
    throw composioGatewayError("Unable to create Composio connection", error, input.integration);
  }
}

async function deleteConnectedAccount(composio: Composio, connectionId: string): Promise<void> {
  try {
    await composio.connectedAccounts.delete(connectionId);
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw composioGatewayError("Unable to delete Composio connection", error);
  }
}

function composioGatewayError(
  message: string,
  error: unknown,
  integration?: IntegrationName,
): APIError {
  return new APIError(503, "upstream_provider_outage", message, {
    details: { errorName: errorName(error), ...(integration ? { integration } : {}) },
    hint: "Check Composio API availability and the configured auth config IDs.",
    retriable: true,
  });
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }
  return typeof error;
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const normalized = `${error.name} ${error.message}`.toLowerCase();
  return normalized.includes("notfound") || normalized.includes("not found");
}

function resolveCallbackUrl(request: Request): string {
  const originUrl = originFromHeader(request.headers.get("Origin"));
  if (originUrl) {
    return new URL("/settings/integrations", originUrl).toString();
  }
  const refererUrl = originFromReferer(request.headers.get("Referer"));
  if (refererUrl) {
    return new URL("/settings/integrations", refererUrl).toString();
  }
  return "https://trycheatcode.com/settings/integrations";
}

function originFromHeader(origin: string | null): string | null {
  if (!origin) {
    return null;
  }
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function originFromReferer(referer: string | null): string | null {
  if (!referer) {
    return null;
  }
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
