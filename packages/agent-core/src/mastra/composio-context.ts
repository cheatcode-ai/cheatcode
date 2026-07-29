import { type IntegrationName, IntegrationNameSchema } from "@cheatcode/types/integrations";
import { z } from "zod/v4";

export type ComposioConnectedAccounts = Partial<Record<IntegrationName, string>>;

export interface ComposioQuotaResult {
  allowed: boolean;
  limit: number;
  remaining: number;
}

export interface ComposioQuotaMeter {
  consumeCall(eventId: string): Promise<ComposioQuotaResult>;
}

// Maps a connected Composio toolkit slug to its connected-account id. Keyed by an
// open toolkit slug (not a fixed 5-enum) so the agent can use any toolkit the user
// has connected from the catalog.
export const ComposioConnectedAccountsSchema = z.record(
  IntegrationNameSchema,
  z.string().min(1).max(500),
);
