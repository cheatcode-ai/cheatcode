import type { UserId } from "@cheatcode/types";
import { UserId as toUserId } from "@cheatcode/types";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { entitlements, users } from "./schema";

export interface BillingUserRecord {
  email: string;
  id: UserId;
  polarCustomerId: string | null;
}

export interface EntitlementUpsertInput {
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  polarSubscriptionId?: string | null;
  subscriptionStatus: string;
  tier: string;
  userId: UserId;
}

export interface EntitlementRecord {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
  polarSubscriptionId: string | null;
  subscriptionStatus: string;
  tier: string;
  updatedAt: Date;
  userId: UserId;
}

export type AgentEntitlementRecord = Pick<
  EntitlementRecord,
  "currentPeriodEnd" | "currentPeriodStart" | "subscriptionStatus" | "tier" | "updatedAt"
>;

export interface EntitlementSubscriptionStateInput {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  polarSubscriptionId: string;
  subscriptionStatus: string;
  userId: UserId;
}

export async function findBillingUserById(
  db: Database,
  userId: UserId,
): Promise<BillingUserRecord | null> {
  const row = await db.query.users.findFirst({
    columns: { email: true, id: true, polarCustomerId: true },
    where: and(eq(users.id, userId), isNull(users.deletedAt)),
  });
  return row
    ? {
        email: row.email,
        id: toUserId(row.id),
        polarCustomerId: row.polarCustomerId,
      }
    : null;
}

export async function findBillingUserByPolarCustomerId(
  db: Database,
  polarCustomerId: string,
): Promise<BillingUserRecord | null> {
  const result = await db.execute(
    sql`select * from public.webhooks_resolve_polar_customer(${polarCustomerId})`,
  );
  const row = result.rows[0] as
    | { email: string; polar_customer_id: string; user_id: string }
    | undefined;
  return row
    ? {
        email: row.email,
        id: toUserId(row.user_id),
        polarCustomerId: row.polar_customer_id,
      }
    : null;
}

export async function findEntitlementByUserId(
  db: Database,
  userId: UserId,
): Promise<EntitlementRecord | null> {
  const row = await db.query.entitlements.findFirst({
    where: eq(entitlements.userId, userId),
  });
  return row
    ? {
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        currentPeriodEnd: row.currentPeriodEnd,
        currentPeriodStart: row.currentPeriodStart,
        polarSubscriptionId: row.polarSubscriptionId,
        subscriptionStatus: row.subscriptionStatus,
        tier: row.tier,
        updatedAt: row.updatedAt,
        userId: toUserId(row.userId),
      }
    : null;
}

/** Agent admission/cache projection; billing ownership fields stay outside the runtime role. */
export async function findAgentEntitlementByUserId(
  db: Database,
  userId: UserId,
): Promise<AgentEntitlementRecord | null> {
  const row = await db.query.entitlements.findFirst({
    columns: {
      currentPeriodEnd: true,
      currentPeriodStart: true,
      subscriptionStatus: true,
      tier: true,
      updatedAt: true,
    },
    where: eq(entitlements.userId, userId),
  });
  return row ?? null;
}

export async function updateUserPolarCustomerId(
  db: Database,
  input: { polarCustomerId: string; userId: UserId },
): Promise<void> {
  await db
    .update(users)
    .set({
      polarCustomerId: input.polarCustomerId,
    })
    .where(eq(users.id, input.userId));
}

/** Serializes entitlement changes with resource-consuming writes for one tenant. */
export async function lockUserEntitlementMutations(db: Database, userId: UserId): Promise<void> {
  const identity = `cheatcode:user-entitlement-mutations:${userId}`;
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
}

export async function upsertEntitlement(
  db: Database,
  input: EntitlementUpsertInput,
): Promise<void> {
  const values = entitlementValues(input);
  await db.transaction(async (tx) => {
    const transaction = tx as Database;
    await lockUserEntitlementMutations(transaction, input.userId);
    await transaction
      .insert(entitlements)
      .values(values)
      .onConflictDoUpdate({
        target: entitlements.userId,
        set: {
          cancelAtPeriodEnd: values.cancelAtPeriodEnd,
          currentPeriodEnd: values.currentPeriodEnd,
          currentPeriodStart: values.currentPeriodStart,
          polarSubscriptionId: values.polarSubscriptionId,
          subscriptionStatus: values.subscriptionStatus,
          tier: values.tier,
          updatedAt: sql`now()`,
        },
      });
  });
}

export async function updateEntitlementSubscriptionState(
  db: Database,
  input: EntitlementSubscriptionStateInput,
): Promise<void> {
  await db
    .update(entitlements)
    .set({
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      currentPeriodStart: input.currentPeriodStart ?? null,
      polarSubscriptionId: input.polarSubscriptionId,
      subscriptionStatus: input.subscriptionStatus,
      updatedAt: sql`now()`,
    })
    .where(eq(entitlements.userId, input.userId));
}

function entitlementValues(input: EntitlementUpsertInput) {
  return {
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    currentPeriodStart: input.currentPeriodStart ?? null,
    polarSubscriptionId: input.polarSubscriptionId ?? null,
    subscriptionStatus: input.subscriptionStatus,
    tier: input.tier,
    userId: input.userId,
  };
}
