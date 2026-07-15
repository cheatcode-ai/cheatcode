import type { Provider, UserId } from "@cheatcode/types";
import { UserId as toUserId } from "@cheatcode/types";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { clerkIdentityHash, lockClerkIdentity } from "./clerk-identity";
import { type Database, withUserContext } from "./client";
import {
  agentRuns,
  billingEvents,
  deletedClerkIdentities,
  entitlements,
  projects,
  providerKeys,
  threads,
  userIntegrations,
  users,
} from "./schema";

export interface UserDeletionContext {
  clerkIdentityHash: string;
  deletionFence: string;
  polarCustomerId: string | null;
  polarCurrentPeriodEndMs: number | null;
  polarCurrentPeriodStartMs: number | null;
  polarSubscriptionId: string | null;
  userId: UserId;
}

export interface UserDeletionPage {
  items: string[];
  nextCursor: string | null;
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

export async function loadUserDeletionContext(
  db: Database,
  userId: UserId,
  deletionFence: string,
): Promise<UserDeletionContext> {
  await requireClaimedUserDeletion(db, userId, deletionFence);
  const [userRow] = await db
    .select({ clerkId: users.clerkId, polarCustomerId: users.polarCustomerId })
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

  if (!userRow) {
    throw new Error("Claimed user disappeared while loading deletion context");
  }

  return {
    clerkIdentityHash: await clerkIdentityHash(userRow.clerkId),
    deletionFence,
    polarCustomerId: userRow.polarCustomerId,
    polarCurrentPeriodEndMs: entitlementRow?.currentPeriodEnd?.getTime() ?? null,
    polarCurrentPeriodStartMs: entitlementRow?.currentPeriodStart?.getTime() ?? null,
    polarSubscriptionId: entitlementRow?.polarSubscriptionId ?? null,
    userId,
  };
}

export async function listUserDeletionRunPage(
  db: Database,
  input: DeletionPageInput,
): Promise<UserDeletionPage> {
  await requireClaimedUserDeletion(db, input.userId, input.deletionFence);
  const rows = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.userId, input.userId),
        input.cursor ? gt(agentRuns.id, input.cursor) : undefined,
      ),
    )
    .orderBy(asc(agentRuns.id))
    .limit(deletionPageLimit(input.limit) + 1);
  return deletionPage(
    rows,
    input.limit,
    (row) => row.id,
    (row) => row.id,
  );
}

export async function listUserDeletionIntegrationPage(
  db: Database,
  input: DeletionPageInput,
): Promise<UserDeletionPage> {
  await requireClaimedUserDeletion(db, input.userId, input.deletionFence);
  const rows = await db
    .select({ connectionId: userIntegrations.composioConnectionId })
    .from(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, input.userId),
        input.cursor ? gt(userIntegrations.composioConnectionId, input.cursor) : undefined,
      ),
    )
    .orderBy(asc(userIntegrations.composioConnectionId))
    .limit(deletionPageLimit(input.limit) + 1);
  return deletionPage(
    rows,
    input.limit,
    (row) => row.connectionId,
    (row) => row.connectionId,
  );
}

interface DeletionPageInput {
  cursor?: string;
  deletionFence: string;
  limit: number;
  userId: UserId;
}

function deletionPageLimit(limit: number): number {
  return Math.max(1, Math.min(500, Math.trunc(limit)));
}

function deletionPage<Row>(
  rows: Row[],
  requestedLimit: number,
  cursor: (row: Row) => string,
  value: (row: Row) => string | null,
): UserDeletionPage {
  const limit = deletionPageLimit(requestedLimit);
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    items: unique(pageRows.map(value).filter(isString)),
    nextCursor: rows.length > limit && last ? cursor(last) : null,
  };
}

export async function archiveUserProjects(
  db: Database,
  userId: UserId,
  deletionFence: string,
): Promise<number> {
  await requireClaimedUserDeletion(db, userId, deletionFence);
  const projectResult = await db.execute(sql`
    with archived as (
      update ${projects}
         set deleted_at = now(), updated_at = now()
       where user_id = ${userId} and deleted_at is null
       returning 1
    )
    select count(*)::int as archived_count from archived
  `);

  await db
    .update(threads)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(threads.userId, userId), isNull(threads.deletedAt)));

  const row = projectResult.rows[0] as { archived_count?: number | string } | undefined;
  return Number(row?.archived_count ?? 0);
}

export async function hardDeleteUserV2Data(
  db: Database,
  userId: UserId,
  deletionFence: string,
  identityHash: string,
): Promise<boolean> {
  if (await hasDeletedClerkIdentity(db, identityHash)) {
    return false;
  }
  await requireClaimedUserDeletion(db, userId, deletionFence);
  await purgeUserProviderKeySecrets(db, userId);

  await withUserContext(db, userId, (tx) =>
    tx.execute(sql`select public.scrub_current_user_audit()`),
  );

  await db
    .update(billingEvents)
    .set({
      payload: sql`jsonb_build_object('scrubbed', true, 'scrubbed_at', now())`,
      userId: null,
    })
    .where(eq(billingEvents.userId, userId));

  return finalizeUserDeletion(db, userId, deletionFence, identityHash);
}

/** Atomically enter the irreversible phase for one exact soft-delete generation. */
export async function claimUserDeletion(
  db: Database,
  userId: UserId,
  deletionMarkedAt: Date,
  deletionFence: string,
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ deletionFence, updatedAt: sql`now()` })
    .where(
      and(
        eq(users.id, userId),
        eq(users.deletedAt, deletionMarkedAt),
        or(isNull(users.deletionFence), eq(users.deletionFence, deletionFence)),
      ),
    )
    .returning({ id: users.id });
  return rows.length > 0;
}

async function requireClaimedUserDeletion(
  db: Database,
  userId: UserId,
  deletionFence: string,
): Promise<void> {
  const row = await db.query.users.findFirst({
    columns: { id: true },
    where: and(eq(users.id, userId), eq(users.deletionFence, deletionFence)),
  });
  if (!row) {
    throw new Error("User deletion fence is no longer valid");
  }
}

async function hasDeletedClerkIdentity(db: Database, identityHash: string): Promise<boolean> {
  const row = await db.query.deletedClerkIdentities.findFirst({
    columns: { clerkIdentityHash: true },
    where: eq(deletedClerkIdentities.clerkIdentityHash, identityHash),
  });
  return Boolean(row);
}

async function finalizeUserDeletion(
  db: Database,
  userId: UserId,
  deletionFence: string,
  identityHash: string,
): Promise<boolean> {
  return db.transaction(async (transaction) => {
    const tx = transaction as Database;
    await lockClerkIdentity(tx, identityHash);
    if (await hasDeletedClerkIdentity(tx, identityHash)) {
      return false;
    }
    await requireClaimedUserDeletion(tx, userId, deletionFence);
    await tx
      .insert(deletedClerkIdentities)
      .values({ clerkIdentityHash: identityHash })
      .onConflictDoNothing();
    const rows = await tx
      .delete(users)
      .where(and(eq(users.id, userId), eq(users.deletionFence, deletionFence)))
      .returning({ id: users.id });
    if (rows.length !== 1) {
      throw new Error("Claimed user deletion did not remove exactly one user");
    }
    return true;
  });
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
