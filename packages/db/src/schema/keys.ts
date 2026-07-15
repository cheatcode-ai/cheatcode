import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export const providerKeys = pgTable(v2TableName("provider_keys"), {
  id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  vaultSecretId: uuid("vault_secret_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  disabledReason: text("disabled_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

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
