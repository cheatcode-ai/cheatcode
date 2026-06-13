import type { UserId } from "@cheatcode/types";
import { UserId as toUserId } from "@cheatcode/types";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { billingEvents, entitlements, users } from "./schema";

export interface BillingUserRecord {
  email: string;
  id: UserId;
  polarCustomerId: string | null;
}

export interface EntitlementUpsertInput {
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  flagPrivateProjects: boolean;
  flagSso: boolean;
  maxConcurrentSandboxes: number;
  maxProjects: number;
  maxSeats: number;
  polarCustomerId?: string | null;
  polarSubscriptionId?: string | null;
  quotaComposioCalls: number;
  quotaDeployments: number;
  quotaSandboxHours: string;
  source: string;
  subscriptionStatus: string;
  tier: string;
  userId: UserId;
  webhookEventId?: string | null;
}

export interface EntitlementRecord {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
  flagPrivateProjects: boolean;
  flagSso: boolean;
  maxConcurrentSandboxes: number;
  maxProjects: number;
  maxSeats: number;
  polarSubscriptionId: string | null;
  quotaComposioCalls: number;
  quotaDeployments: number;
  quotaSandboxHours: string;
  subscriptionStatus: string;
  tier: string;
  updatedAt: Date;
  userId: UserId;
}

export interface BillingEventInput {
  eventType: string;
  payload: Record<string, unknown>;
  polarEventId?: string | null;
  userId?: UserId | null;
}

export interface EntitlementSubscriptionStateInput {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  polarSubscriptionId: string;
  source: string;
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
  const row = await db.query.users.findFirst({
    columns: { email: true, id: true, polarCustomerId: true },
    where: and(eq(users.polarCustomerId, polarCustomerId), isNull(users.deletedAt)),
  });
  return row
    ? {
        email: row.email,
        id: toUserId(row.id),
        polarCustomerId: row.polarCustomerId,
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
        flagPrivateProjects: row.flagPrivateProjects,
        flagSso: row.flagSso,
        maxConcurrentSandboxes: row.maxConcurrentSandboxes,
        maxProjects: row.maxProjects,
        maxSeats: row.maxSeats,
        polarSubscriptionId: row.polarSubscriptionId,
        quotaComposioCalls: row.quotaComposioCalls,
        quotaDeployments: row.quotaDeployments,
        quotaSandboxHours: row.quotaSandboxHours,
        subscriptionStatus: row.subscriptionStatus,
        tier: row.tier,
        updatedAt: row.updatedAt,
        userId: toUserId(row.userId),
      }
    : null;
}

export async function updateUserPolarCustomerId(
  db: Database,
  input: { polarCustomerId: string; userId: UserId },
): Promise<void> {
  await db
    .update(users)
    .set({
      polarCustomerId: input.polarCustomerId,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, input.userId));
}

export async function upsertEntitlement(
  db: Database,
  input: EntitlementUpsertInput,
): Promise<void> {
  const values = entitlementValues(input);
  await db
    .insert(entitlements)
    .values(values)
    .onConflictDoUpdate({
      target: entitlements.userId,
      set: {
        cancelAtPeriodEnd: values.cancelAtPeriodEnd,
        currentPeriodEnd: values.currentPeriodEnd,
        currentPeriodStart: values.currentPeriodStart,
        flagPrivateProjects: values.flagPrivateProjects,
        flagSso: values.flagSso,
        maxConcurrentSandboxes: values.maxConcurrentSandboxes,
        maxProjects: values.maxProjects,
        maxSeats: values.maxSeats,
        polarCustomerId: values.polarCustomerId,
        polarSubscriptionId: values.polarSubscriptionId,
        quotaComposioCalls: values.quotaComposioCalls,
        quotaDeployments: values.quotaDeployments,
        quotaSandboxHours: values.quotaSandboxHours,
        source: values.source,
        subscriptionStatus: values.subscriptionStatus,
        tier: values.tier,
        updatedAt: sql`now()`,
        webhookEventId: values.webhookEventId,
      },
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
      source: input.source,
      subscriptionStatus: input.subscriptionStatus,
      updatedAt: sql`now()`,
    })
    .where(eq(entitlements.userId, input.userId));
}

export async function recordBillingEvent(db: Database, input: BillingEventInput): Promise<void> {
  await db
    .insert(billingEvents)
    .values({
      eventType: input.eventType,
      payload: input.payload,
      ...(input.polarEventId !== undefined ? { polarEventId: input.polarEventId } : {}),
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
    })
    .onConflictDoNothing();
}

function entitlementValues(input: EntitlementUpsertInput) {
  return {
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    currentPeriodStart: input.currentPeriodStart ?? null,
    flagPrivateProjects: input.flagPrivateProjects,
    flagSso: input.flagSso,
    maxConcurrentSandboxes: input.maxConcurrentSandboxes,
    maxProjects: input.maxProjects,
    maxSeats: input.maxSeats,
    polarCustomerId: input.polarCustomerId ?? null,
    polarSubscriptionId: input.polarSubscriptionId ?? null,
    quotaComposioCalls: input.quotaComposioCalls,
    quotaDeployments: input.quotaDeployments,
    quotaSandboxHours: input.quotaSandboxHours,
    source: input.source,
    subscriptionStatus: input.subscriptionStatus,
    tier: input.tier,
    userId: input.userId,
    webhookEventId: input.webhookEventId ?? null,
  };
}
