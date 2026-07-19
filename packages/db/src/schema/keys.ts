import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export const providerKeys = pgTable(
  v2TableName("provider_keys"),
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    vaultSecretId: uuid("vault_secret_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    lastRevalidatedAt: timestamp("last_revalidated_at", { withTimezone: true }),
    revalidationClaimedAt: timestamp("revalidation_claimed_at", { withTimezone: true }),
    revalidationLeaseToken: uuid("revalidation_lease_token"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: text("disabled_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.provider] }),
    fingerprintShape: check(
      "v2_provider_keys_fingerprint_check",
      sql`${table.fingerprint} ~ '^[0-9a-f]{12}$'`,
    ),
    disabledPair: check(
      "v2_provider_keys_disabled_pair_check",
      sql`(${table.disabledAt} is null and ${table.disabledReason} is null) or (${table.disabledAt} is not null and ${table.disabledReason} is not null)`,
    ),
    revalidationLeasePair: check(
      "v2_provider_keys_revalidation_lease_pair_check",
      sql`(${table.revalidationClaimedAt} is null and ${table.revalidationLeaseToken} is null) or (${table.revalidationClaimedAt} is not null and ${table.revalidationLeaseToken} is not null)`,
    ),
    revalidationLeaseIdx: index("v2_provider_keys_revalidation_lease_idx")
      .on(
        table.lastRevalidatedAt.asc().nullsFirst(),
        table.revalidationClaimedAt.asc().nullsFirst(),
        table.createdAt,
        table.userId,
        table.provider,
      )
      .where(sql`${table.disabledAt} is null`),
    vaultSecretUnique: uniqueIndex("v2_provider_keys_vault_secret_uidx").on(table.vaultSecretId),
  }),
);

export const userIntegrations = pgTable(
  v2TableName("user_integrations"),
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    integration: text("integration").notNull(),
    composioConnectionId: text("composio_connection_id").primaryKey(),
    isDefault: boolean("is_default").notNull().default(false),
    status: text("status").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    connectionIdIsBounded: check(
      "v2_user_integrations_connection_id_check",
      sql`${table.composioConnectionId} = btrim(${table.composioConnectionId}) and length(${table.composioConnectionId}) between 1 and 256`,
    ),
    defaultIsActive: check(
      "v2_user_integrations_default_active_check",
      sql`not ${table.isDefault} or lower(${table.status}) in ('active', 'authorized', 'connected', 'enabled')`,
    ),
    integrationIsSlug: check(
      "v2_user_integrations_integration_check",
      sql`${table.integration} ~ '^[a-z0-9_]{1,64}$'`,
    ),
    oneDefaultPerToolkit: uniqueIndex("v2_user_integrations_one_default_idx")
      .on(table.userId, table.integration)
      .where(sql`${table.isDefault} = true`),
    deletionPageIdx: index("v2_user_integrations_delete_page_idx").on(
      table.userId,
      table.composioConnectionId,
    ),
    toolkitIdx: index("v2_user_integrations_user_toolkit_idx").on(table.userId, table.integration),
  }),
);
