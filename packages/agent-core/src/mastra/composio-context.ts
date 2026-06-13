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

export const ComposioConnectedAccountsSchema = z
  .object({
    github: z.string().min(1).optional(),
    gmail: z.string().min(1).optional(),
    linear: z.string().min(1).optional(),
    notion: z.string().min(1).optional(),
    slack: z.string().min(1).optional(),
  })
  .strict();
