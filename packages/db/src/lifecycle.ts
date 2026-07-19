import type { Provider, UserId } from "@cheatcode/types";
import { UserId as toUserId } from "@cheatcode/types";
import { and, asc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { clerkIdentityHash } from "./clerk-identity";
import { type Database, withUserContext } from "./client";
import {
  agentRuns,
  artifactUploadIntents,
  entitlements,
  projects,
  providerKeys,
  threads,
  userDeletionRefundIntents,
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
  leaseToken: string;
  provider: string;
  userId: UserId;
}

export interface CompleteCurrentProviderKeyRevalidationInput {
  expectedFingerprint: string;
  expectedLeaseToken: string;
  provider: Provider;
  userId: UserId;
}

export interface DisableCurrentProviderKeyInput {
  expectedFingerprint: string;
  expectedLeaseToken: string;
  provider: Provider;
  reason: string;
  userId: UserId;
}

const PROVIDER_KEY_REVALIDATION_PAGE_SIZE = 10;

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
  return withUserContext(db, userId, async (tx) => {
    await requireClaimedUserDeletion(tx, userId, deletionFence);
    const pendingUpload = await tx.query.artifactUploadIntents.findFirst({
      columns: { id: true },
      where: eq(artifactUploadIntents.userId, userId),
    });
    if (pendingUpload) {
      throw new Error("Account deletion refused while artifact upload intents remain");
    }
    const unresolvedRefund = await tx.query.userDeletionRefundIntents.findFirst({
      columns: { jobId: true },
      where: and(
        eq(userDeletionRefundIntents.userId, userId),
        sql`${userDeletionRefundIntents.providerStatus} is distinct from 'succeeded'`,
      ),
    });
    if (unresolvedRefund) {
      throw new Error("Account deletion refused while a refund intent remains unresolved");
    }
    await tx.execute(sql`select delete_all_provider_keys()`);
    await tx.execute(sql`select public.scrub_current_user_audit()`);
    const result = await tx.execute(sql`
      select public.webhooks_finalize_current_user_deletion(
        ${deletionFence},
        ${identityHash}
      ) as finalized
    `);
    return result.rows[0]?.["finalized"] === true;
  });
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

export async function purgeUserProviderKeySecrets(db: Database, userId: UserId): Promise<number> {
  const result = await withUserContext(db, userId, (tx) =>
    tx.execute(sql`select delete_all_provider_keys() as deleted_count`),
  );
  const row = result.rows[0] as { deleted_count?: number | string } | undefined;
  return Number(row?.deleted_count ?? 0);
}

export async function claimProviderKeyRevalidationTargets(
  db: Database,
  limit: number,
): Promise<ProviderKeyRevalidationTarget[]> {
  const pageSize = Math.max(1, Math.min(PROVIDER_KEY_REVALIDATION_PAGE_SIZE, Math.trunc(limit)));
  const result = await db.execute(sql`
    select user_id, provider, fingerprint, lease_token
      from public.claim_provider_key_revalidation_targets(${pageSize})
  `);
  const rows = result.rows as Array<{
    fingerprint: string;
    lease_token: string;
    provider: string;
    user_id: string;
  }>;

  return rows.map((row) => ({
    fingerprint: row.fingerprint,
    leaseToken: row.lease_token,
    provider: row.provider,
    userId: toUserId(row.user_id),
  }));
}

export async function completeCurrentProviderKeyRevalidation(
  db: Database,
  input: CompleteCurrentProviderKeyRevalidationInput,
): Promise<boolean> {
  const rows = await db
    .update(providerKeys)
    .set({
      lastRevalidatedAt: sql`now()`,
      revalidationClaimedAt: null,
      revalidationLeaseToken: null,
    })
    .where(currentProviderKeyLease(input))
    .returning({ provider: providerKeys.provider });
  return rows.length > 0;
}

export async function disableCurrentProviderKey(
  db: Database,
  input: DisableCurrentProviderKeyInput,
): Promise<boolean> {
  const rows = await db
    .update(providerKeys)
    .set({
      disabledAt: sql`now()`,
      disabledReason: input.reason,
      lastRevalidatedAt: sql`now()`,
      revalidationClaimedAt: null,
      revalidationLeaseToken: null,
    })
    .where(currentProviderKeyLease(input))
    .returning({ provider: providerKeys.provider });
  return rows.length > 0;
}

function currentProviderKeyLease(input: CompleteCurrentProviderKeyRevalidationInput) {
  return and(
    eq(providerKeys.userId, input.userId),
    eq(providerKeys.provider, input.provider),
    eq(providerKeys.fingerprint, input.expectedFingerprint),
    eq(providerKeys.revalidationLeaseToken, input.expectedLeaseToken),
    gte(providerKeys.revalidationClaimedAt, sql`now() - interval '15 minutes'`),
    isNull(providerKeys.disabledAt),
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}
