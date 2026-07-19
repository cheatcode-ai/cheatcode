import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { userDeletionJobs } from "./user-deletions";

export type UserDeletionRefundProviderStatus = "pending" | "succeeded" | "failed" | "canceled";

/**
 * Immutable refund authority for one account-deletion generation. Mutable
 * provider evidence is filled only after Polar returns or reconciliation finds
 * the exact metadata identity.
 */
export const userDeletionRefundIntents = pgTable(
  v2TableName("user_deletion_refund_intents"),
  {
    jobId: uuid("job_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    generation: timestamp("generation", { withTimezone: true }).notNull(),
    orderId: text("order_id").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    providerRefundId: text("provider_refund_id"),
    providerStatus: text("provider_status").$type<UserDeletionRefundProviderStatus>(),
    createdAt: timestamp("created_at", { precision: 3, withTimezone: true }).notNull().defaultNow(),
    reconciledAt: timestamp("reconciled_at", { precision: 3, withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.jobId, table.userId, table.generation],
      foreignColumns: [userDeletionJobs.id, userDeletionJobs.userId, userDeletionJobs.generation],
      name: "v2_user_deletion_refund_intents_job_identity_fk",
    }).onDelete("cascade"),
    uniqueIndex("v2_user_deletion_refund_intents_idempotency_uidx").on(table.idempotencyKey),
    uniqueIndex("v2_user_deletion_refund_intents_provider_uidx")
      .on(table.providerRefundId)
      .where(sql`${table.providerRefundId} is not null`),
    index("v2_user_deletion_refund_intents_unresolved_idx")
      .on(table.userId, table.jobId)
      .where(sql`${table.providerStatus} is distinct from 'succeeded'`),
    check("v2_user_deletion_refund_intents_amount_check", sql`${table.amount} > 0`),
    check("v2_user_deletion_refund_intents_currency_check", sql`${table.currency} ~ '^[a-z]{3}$'`),
    check("v2_user_deletion_refund_intents_order_check", sql`length(btrim(${table.orderId})) > 0`),
    check(
      "v2_user_deletion_refund_intents_identity_check",
      sql`${table.idempotencyKey} = 'cheatcode:user-deletion-refund:' || ${table.jobId}::text`,
    ),
    check(
      "v2_user_deletion_refund_intents_provider_check",
      sql`(
        (${table.providerRefundId} is null and ${table.providerStatus} is null and ${table.reconciledAt} is null)
        or
        (${table.providerRefundId} is not null and length(btrim(${table.providerRefundId})) > 0 and ${table.providerStatus} is not null and ${table.providerStatus} in ('pending', 'succeeded', 'failed', 'canceled') and ${table.reconciledAt} is not null)
      )`,
    ),
  ],
);
