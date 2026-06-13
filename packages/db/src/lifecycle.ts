import type { Provider, UserId } from "@cheatcode/types";
import { UserId as toUserId } from "@cheatcode/types";
import { and, eq, isNull, sql } from "drizzle-orm";
import { type Database, withUserContext } from "./client";
import {
  agentRuns,
  billingEvents,
  entitlements,
  generatedOutputs,
  projects,
  providerKeys,
  threads,
  userIntegrations,
  users,
} from "./schema";

export interface UserDeletionManifest {
  composioConnectionIds: string[];
  outputKeys: string[];
  polarCustomerId: string | null;
  polarCurrentPeriodEnd: Date | null;
  polarCurrentPeriodStart: Date | null;
  polarSubscriptionId: string | null;
  projectIds: string[];
  runIds: string[];
  sandboxIds: string[];
  userId: UserId;
}

export interface ProviderKeyRevalidationTarget {
  fingerprint: string;
  provider: string;
  userId: UserId;
}

export interface DisableProviderKeyInput {
  provider: Provider;
  reason: string;
  userId: UserId;
}

export async function buildUserDeletionManifest(
  db: Database,
  userId: UserId,
): Promise<UserDeletionManifest> {
  const [userRow] = await db
    .select({ polarCustomerId: users.polarCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const [entitlementRow] = await db
    .select({
      currentPeriodEnd: entitlements.currentPeriodEnd,
      currentPeriodStart: entitlements.currentPeriodStart,
      polarSubscriptionId: entitlements.polarSubscriptionId,
    })
    .from(entitlements)
    .where(eq(entitlements.userId, userId))
    .limit(1);

  const projectRows = await db
    .select({ id: projects.id, sandboxId: projects.sandboxId })
    .from(projects)
    .where(eq(projects.userId, userId));
  const runRows = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(eq(agentRuns.userId, userId));
  const outputRows = await db
    .select({ r2Key: generatedOutputs.r2Key })
    .from(generatedOutputs)
    .where(eq(generatedOutputs.userId, userId));
  const integrationRows = await db
    .select({ composioConnectionId: userIntegrations.composioConnectionId })
    .from(userIntegrations)
    .where(eq(userIntegrations.userId, userId));

  return {
    composioConnectionIds: unique(integrationRows.map((row) => row.composioConnectionId)),
    outputKeys: unique(outputRows.map((row) => row.r2Key)),
    polarCustomerId: userRow?.polarCustomerId ?? null,
    polarCurrentPeriodEnd: entitlementRow?.currentPeriodEnd ?? null,
    polarCurrentPeriodStart: entitlementRow?.currentPeriodStart ?? null,
    polarSubscriptionId: entitlementRow?.polarSubscriptionId ?? null,
    projectIds: unique(projectRows.map((row) => row.id)),
    runIds: unique(runRows.map((row) => row.id)),
    sandboxIds: unique(projectRows.map((row) => row.sandboxId).filter(isString)),
    userId,
  };
}

export async function archiveUserProjects(db: Database, userId: UserId): Promise<number> {
  const archivedAt = sql`now()`;
  const projectRows = await db
    .update(projects)
    .set({ deletedAt: archivedAt, updatedAt: archivedAt })
    .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)))
    .returning({ id: projects.id });

  await db
    .update(threads)
    .set({ deletedAt: archivedAt, updatedAt: archivedAt })
    .where(and(eq(threads.userId, userId), isNull(threads.deletedAt)));

  return projectRows.length;
}

export async function hardDeleteUserV2Data(db: Database, userId: UserId): Promise<boolean> {
  await purgeUserProviderKeySecrets(db, userId);

  await db
    .update(billingEvents)
    .set({
      payload: sql`jsonb_build_object('scrubbed', true, 'scrubbed_at', now())`,
      userId: null,
    })
    .where(eq(billingEvents.userId, userId));

  const rows = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  return rows.length > 0;
}

export async function purgeUserProviderKeySecrets(db: Database, userId: UserId): Promise<number> {
  const result = await withUserContext(db, userId, (tx) =>
    tx.execute(sql`select delete_all_provider_keys() as deleted_count`),
  );
  const row = result.rows[0] as { deleted_count?: number | string } | undefined;
  return Number(row?.deleted_count ?? 0);
}

export async function listProviderKeyRevalidationTargets(
  db: Database,
  limit: number,
): Promise<ProviderKeyRevalidationTarget[]> {
  const result = await db.execute(sql`
    select user_id, provider, fingerprint
      from public.list_provider_key_revalidation_targets(${limit})
  `);
  const rows = result.rows as Array<{ fingerprint: string; provider: string; user_id: string }>;

  return rows.map((row) => ({
    fingerprint: row.fingerprint,
    provider: row.provider,
    userId: toUserId(row.user_id),
  }));
}

export async function disableProviderKey(
  db: Database,
  input: DisableProviderKeyInput,
): Promise<boolean> {
  const rows = await db
    .update(providerKeys)
    .set({
      disabledAt: sql`now()`,
      disabledReason: input.reason,
    })
    .where(
      and(
        eq(providerKeys.userId, input.userId),
        eq(providerKeys.provider, input.provider),
        isNull(providerKeys.deletedAt),
        isNull(providerKeys.disabledAt),
      ),
    )
    .returning({ id: providerKeys.id });
  return rows.length > 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}
