import { UserId } from "@cheatcode/types";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import { userIntegrations } from "./schema";

const ACTIVE_INTEGRATION_STATUSES = new Set(["active", "authorized", "connected", "enabled"]);

export interface UserIntegrationRecord {
  composioConnectionId: string;
  connectedAt: Date;
  integration: string;
  isDefault: boolean;
  status: string;
  updatedAt: Date;
  userId: UserId;
}

export interface UserIntegrationUpsertInput {
  composioConnectionId: string;
  integration: string;
  status: string;
  userId: UserId;
}

export async function upsertUserIntegration(
  db: Database,
  input: UserIntegrationUpsertInput,
): Promise<void> {
  await db.transaction((tx) => upsertUserIntegrationLocked(tx as Database, input));
}

export async function upsertUserIntegrations(
  db: Database,
  inputs: readonly UserIntegrationUpsertInput[],
): Promise<void> {
  const [firstInput] = inputs;
  if (!firstInput) {
    return;
  }
  assertBulkUpsertInput(inputs);
  await db.transaction(async (tx) => {
    const transaction = tx as Database;
    await lockIntegrationToolkits(transaction, firstInput.userId, inputs);
    const upserted = await transaction
      .insert(userIntegrations)
      .values(inputs.map(integrationInsertValues))
      .onConflictDoUpdate({
        target: userIntegrations.composioConnectionId,
        set: {
          isDefault: sql`case
            when lower(excluded.status) in ('active', 'authorized', 'connected', 'enabled')
              then ${userIntegrations.isDefault}
            else false
          end`,
          status: sql`excluded.status`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${userIntegrations.userId} = excluded.user_id
          and ${userIntegrations.integration} = excluded.integration`,
      })
      .returning({ composioConnectionId: userIntegrations.composioConnectionId });
    if (upserted.length !== inputs.length) {
      throw new Error("Composio connection ownership invariant violated");
    }
    await ensureDefaultToolkits(transaction, firstInput.userId, inputs);
  });
}

async function upsertUserIntegrationLocked(
  db: Database,
  input: UserIntegrationUpsertInput,
): Promise<void> {
  await lockIntegrationAccounts(db, input);
  const upserted = await db
    .insert(userIntegrations)
    .values({
      composioConnectionId: input.composioConnectionId,
      integration: input.integration,
      isDefault: false,
      status: input.status,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      target: userIntegrations.composioConnectionId,
      set: {
        ...(!isActiveIntegrationStatus(input.status) ? { isDefault: false } : {}),
        status: input.status,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${userIntegrations.userId} = ${input.userId}
        and ${userIntegrations.integration} = ${input.integration}`,
    })
    .returning({ composioConnectionId: userIntegrations.composioConnectionId });
  if (upserted.length !== 1) {
    throw new Error("Composio connection ownership invariant violated");
  }
  await ensureDefaultUserIntegration(db, input);
}

export async function listUserIntegrations(
  db: Database,
  userId: UserId,
): Promise<UserIntegrationRecord[]> {
  const rows = await db
    .select(selection())
    .from(userIntegrations)
    .where(eq(userIntegrations.userId, userId))
    .orderBy(
      userIntegrations.integration,
      desc(userIntegrations.isDefault),
      desc(userIntegrations.updatedAt),
    );
  return rows.map(toUserIntegrationRecord);
}

export async function findUserIntegrationByConnectionId(
  db: Database,
  input: { composioConnectionId: string; integration: string; userId: UserId },
): Promise<UserIntegrationRecord | null> {
  const rows = await db
    .select(selection())
    .from(userIntegrations)
    .where(accountPredicate(input))
    .limit(1);
  return rows[0] ? toUserIntegrationRecord(rows[0]) : null;
}

export async function setDefaultUserIntegration(
  db: Database,
  input: { composioConnectionId: string; integration: string; userId: UserId },
): Promise<boolean> {
  return db.transaction((tx) => setDefaultUserIntegrationLocked(tx as Database, input));
}

async function setDefaultUserIntegrationLocked(
  db: Database,
  input: { composioConnectionId: string; integration: string; userId: UserId },
): Promise<boolean> {
  await lockIntegrationAccounts(db, input);
  const target = await db.execute(sql`
    select 1
      from ${userIntegrations}
     where user_id = ${input.userId}
       and integration = ${input.integration}
       and composio_connection_id = ${input.composioConnectionId}
       and lower(status) in ('active', 'authorized', 'connected', 'enabled')
     limit 1
  `);
  if (target.rows.length === 0) {
    return false;
  }
  await db
    .update(userIntegrations)
    .set({ isDefault: false, updatedAt: sql`now()` })
    .where(
      and(
        eq(userIntegrations.userId, input.userId),
        eq(userIntegrations.integration, input.integration),
      ),
    );
  const updated = await db
    .update(userIntegrations)
    .set({ isDefault: true, updatedAt: sql`now()` })
    .where(accountPredicate(input))
    .returning({ composioConnectionId: userIntegrations.composioConnectionId });
  return updated.length > 0;
}

export async function updateUserIntegrationStatusByConnectionId(
  db: Database,
  input: { composioConnectionId: string; status: string },
): Promise<boolean> {
  return db.transaction((tx) =>
    updateUserIntegrationStatusByConnectionIdLocked(tx as Database, input),
  );
}

async function updateUserIntegrationStatusByConnectionIdLocked(
  db: Database,
  input: { composioConnectionId: string; status: string },
): Promise<boolean> {
  const [target] = await db
    .select({ integration: userIntegrations.integration, userId: userIntegrations.userId })
    .from(userIntegrations)
    .where(eq(userIntegrations.composioConnectionId, input.composioConnectionId))
    .limit(1);
  if (!target) {
    return false;
  }
  const owner = { integration: target.integration, userId: UserId(target.userId) };
  await lockIntegrationAccounts(db, owner);
  const rows = await db
    .update(userIntegrations)
    .set({
      ...(!isActiveIntegrationStatus(input.status) ? { isDefault: false } : {}),
      status: input.status,
      updatedAt: sql`now()`,
    })
    .where(
      accountPredicate({
        composioConnectionId: input.composioConnectionId,
        ...owner,
      }),
    )
    .returning({ composioConnectionId: userIntegrations.composioConnectionId });
  if (rows.length === 0) {
    return false;
  }
  await ensureDefaultUserIntegration(db, owner);
  return true;
}

export async function deleteUserIntegrationAccount(
  db: Database,
  input: { composioConnectionId: string; integration: string; userId: UserId },
): Promise<void> {
  await db.transaction((tx) => deleteUserIntegrationAccountLocked(tx as Database, input));
}

export async function deleteUserIntegrationAccounts(
  db: Database,
  userId: UserId,
  accounts: readonly Pick<UserIntegrationRecord, "composioConnectionId" | "integration">[],
): Promise<void> {
  if (accounts.length === 0) {
    return;
  }
  await db.transaction(async (tx) => {
    const transaction = tx as Database;
    await lockIntegrationToolkits(transaction, userId, accounts);
    const deleted = await transaction
      .delete(userIntegrations)
      .where(integrationAccountGroupsPredicate(userId, accounts))
      .returning({
        integration: userIntegrations.integration,
        isDefault: userIntegrations.isDefault,
      });
    const defaultToolkits = deleted
      .filter((record) => record.isDefault)
      .map((record) => ({ integration: record.integration }));
    await ensureDefaultToolkits(transaction, userId, defaultToolkits);
  });
}

async function deleteUserIntegrationAccountLocked(
  db: Database,
  input: { composioConnectionId: string; integration: string; userId: UserId },
): Promise<void> {
  await lockIntegrationAccounts(db, input);
  const deleted = await db
    .delete(userIntegrations)
    .where(accountPredicate(input))
    .returning({ isDefault: userIntegrations.isDefault });
  if (!deleted[0]?.isDefault) {
    return;
  }
  await ensureDefaultUserIntegration(db, input);
}

async function ensureDefaultUserIntegration(
  db: Database,
  input: { integration: string; userId: UserId },
): Promise<void> {
  await db.execute(sql`
    update ${userIntegrations}
       set is_default = false,
           updated_at = now()
     where user_id = ${input.userId}
       and integration = ${input.integration}
       and is_default = true
       and lower(status) not in ('active', 'authorized', 'connected', 'enabled')
  `);
  await db.execute(sql`
    update ${userIntegrations}
       set is_default = true,
           updated_at = now()
     where user_id = ${input.userId}
       and integration = ${input.integration}
       and composio_connection_id = (
         select composio_connection_id
           from ${userIntegrations}
          where user_id = ${input.userId}
            and integration = ${input.integration}
            and lower(status) in ('active', 'authorized', 'connected', 'enabled')
          order by updated_at desc
          limit 1
       )
       and not exists (
         select 1
           from ${userIntegrations} existing
          where existing.user_id = ${input.userId}
            and existing.integration = ${input.integration}
            and existing.is_default = true
       )
  `);
}

async function lockIntegrationAccounts(
  db: Database,
  input: { integration: string; userId: UserId },
): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${input.integration}`}, 0))`,
  );
}

async function lockIntegrationToolkits(
  db: Database,
  userId: UserId,
  accounts: readonly { integration: string }[],
): Promise<void> {
  const integrations = [...new Set(accounts.map((account) => account.integration))].sort();
  for (const integration of integrations) {
    await lockIntegrationAccounts(db, { integration, userId });
  }
}

async function ensureDefaultToolkits(
  db: Database,
  userId: UserId,
  accounts: readonly { integration: string }[],
): Promise<void> {
  const integrations = [...new Set(accounts.map((account) => account.integration))].sort();
  for (const integration of integrations) {
    await ensureDefaultUserIntegration(db, { integration, userId });
  }
}

function assertBulkUpsertInput(inputs: readonly UserIntegrationUpsertInput[]): void {
  const userId = inputs[0]?.userId;
  const connectionIds = new Set<string>();
  for (const input of inputs) {
    if (input.userId !== userId || connectionIds.has(input.composioConnectionId)) {
      throw new Error("Bulk integration reconciliation requires one user and unique connections");
    }
    connectionIds.add(input.composioConnectionId);
  }
}

function integrationInsertValues(input: UserIntegrationUpsertInput) {
  return {
    composioConnectionId: input.composioConnectionId,
    integration: input.integration,
    isDefault: false,
    status: input.status,
    userId: input.userId,
  };
}

function integrationAccountGroupsPredicate(
  userId: UserId,
  accounts: readonly Pick<UserIntegrationRecord, "composioConnectionId" | "integration">[],
) {
  const byIntegration = new Map<string, string[]>();
  for (const account of accounts) {
    const ids = byIntegration.get(account.integration) ?? [];
    ids.push(account.composioConnectionId);
    byIntegration.set(account.integration, ids);
  }
  return and(
    eq(userIntegrations.userId, userId),
    or(
      ...[...byIntegration].map(([integration, connectionIds]) =>
        and(
          eq(userIntegrations.integration, integration),
          inArray(userIntegrations.composioConnectionId, connectionIds),
        ),
      ),
    ),
  );
}

function isActiveIntegrationStatus(status: string): boolean {
  return ACTIVE_INTEGRATION_STATUSES.has(status.trim().toLowerCase());
}

function accountPredicate(input: {
  composioConnectionId: string;
  integration: string;
  userId: UserId;
}) {
  return and(
    eq(userIntegrations.userId, input.userId),
    eq(userIntegrations.integration, input.integration),
    eq(userIntegrations.composioConnectionId, input.composioConnectionId),
  );
}

function selection() {
  return {
    composioConnectionId: userIntegrations.composioConnectionId,
    connectedAt: userIntegrations.connectedAt,
    integration: userIntegrations.integration,
    isDefault: userIntegrations.isDefault,
    status: userIntegrations.status,
    updatedAt: userIntegrations.updatedAt,
    userId: userIntegrations.userId,
  };
}

function toUserIntegrationRecord(row: {
  composioConnectionId: string;
  connectedAt: Date;
  integration: string;
  isDefault: boolean;
  status: string;
  updatedAt: Date;
  userId: string;
}): UserIntegrationRecord {
  return {
    ...row,
    userId: UserId(row.userId),
  };
}
