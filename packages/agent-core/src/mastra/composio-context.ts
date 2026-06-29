import type { IntegrationName } from "@cheatcode/types";
import { z } from "zod/v4";

export const COMPOSIO_API_KEY_CONTEXT_KEY = "composioApiKey";
export const COMPOSIO_CONNECTED_ACCOUNTS_CONTEXT_KEY = "composioConnectedAccounts";
export const COMPOSIO_QUOTA_METER_CONTEXT_KEY = "composioQuotaMeter";
export const COMPOSIO_USER_ID_CONTEXT_KEY = "composioUserId";

export type ComposioConnectedAccounts = Partial<Record<IntegrationName, string>>;

export interface ComposioQuotaResult {
  allowed: boolean;
  limit: number;
  remaining: number;
}

export interface ComposioQuotaMeter {
  consumeCall(): Promise<ComposioQuotaResult>;
}

// Maps a connected Composio toolkit slug to its connected-account id. Keyed by an
// open toolkit slug (not a fixed 5-enum) so the agent can use any toolkit the user
// has connected from the catalog.
export const ComposioConnectedAccountsSchema = z.record(
  z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/),
  z.string().min(1),
);
