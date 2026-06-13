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

const ComposioAuthConfigMapSchema = z
  .object({
    github: z.string().min(1).optional(),
    gmail: z.string().min(1).optional(),
    linear: z.string().min(1).optional(),
    notion: z.string().min(1).optional(),
    slack: z.string().min(1).optional(),
  })
  .strict();

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
  return SUPPORTED_INTEGRATIONS.map((supported) =>
    integrationSummary(supported.name, supported.displayName, byName.get(supported.name)),
  );
}

export async function connectIntegration(input: ConnectIntegrationInput): Promise<Response> {
  const apiKey = await readRequiredSecret(input.env.COMPOSIO_API_KEY, "COMPOSIO_API_KEY");
  const authConfigId = await readAuthConfigId(input.env, input.integration);
  const composio = new Composio({ apiKey });
  const callbackUrl = resolveCallbackUrl(input.request);
  const connection = await createConnectionLink({
    authConfigId,
    callbackUrl,
    composio,
    integration: input.integration,
    userId: input.userId,
  });
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
  const composio = new Composio({ apiKey });
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

async function readAuthConfigId(
  env: IntegrationEnv,
  integration: IntegrationName,
): Promise<string> {
  const raw = await readRequiredSecret(env.COMPOSIO_AUTH_CONFIGS, "COMPOSIO_AUTH_CONFIGS");
  const parsedJson = parseAuthConfigJson(raw);
  const authConfigId = parsedJson[integration];
  if (!authConfigId) {
    throw new APIError(503, "unavailable_maintenance", "Composio integration is not configured", {
      details: { integration },
      hint: "Add this integration to COMPOSIO_AUTH_CONFIGS.",
      retriable: false,
    });
  }
  return authConfigId;
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
