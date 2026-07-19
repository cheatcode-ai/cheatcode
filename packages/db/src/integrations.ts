import { UserId } from "@cheatcode/types";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
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

export type AgentIntegrationRecord = Pick<
  UserIntegrationRecord,
  "composioConnectionId" | "integration" | "isDefault" | "status"
>;

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
    await transaction
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
        },
        setWhere: sql`${userIntegrations.userId} = excluded.user_id
          and ${userIntegrations.integration} = excluded.integration
          and (
            ${userIntegrations.status} is distinct from excluded.status
            or ${userIntegrations.isDefault} is distinct from case
              when lower(excluded.status) in ('active', 'authorized', 'connected', 'enabled')
                then ${userIntegrations.isDefault}
              else false
            end
          )`,
      });
    await requireIntegrationOwnership(transaction, inputs);
    await ensureDefaultToolkits(transaction, firstInput.userId, inputs);
  });
}

async function upsertUserIntegrationLocked(
  db: Database,
  input: UserIntegrationUpsertInput,
): Promise<void> {
  await lockIntegrationAccounts(db, input);
  await db
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
      },
      setWhere: sql`${userIntegrations.userId} = ${input.userId}
        and ${userIntegrations.integration} = ${input.integration}
        and (
          ${userIntegrations.status} is distinct from ${input.status}
          or ${userIntegrations.isDefault} is distinct from ${isActiveIntegrationStatus(input.status) ? userIntegrations.isDefault : false}
        )`,
    });
  await requireIntegrationOwnership(db, [input]);
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

/** Runtime projection for connected-account routing without lifecycle timestamps. */
export async function listAgentIntegrations(
  db: Database,
  userId: UserId,
): Promise<AgentIntegrationRecord[]> {
  return db
    .select({
      composioConnectionId: userIntegrations.composioConnectionId,
      integration: userIntegrations.integration,
      isDefault: userIntegrations.isDefault,
      status: userIntegrations.status,
    })
    .from(userIntegrations)
    .where(eq(userIntegrations.userId, userId))
    .orderBy(
      userIntegrations.integration,
      desc(userIntegrations.isDefault),
      desc(userIntegrations.updatedAt),
    );
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
    .set({ isDefault: false })
    .where(
      and(
        eq(userIntegrations.userId, input.userId),
        eq(userIntegrations.integration, input.integration),
        ne(userIntegrations.composioConnectionId, input.composioConnectionId),
        eq(userIntegrations.isDefault, true),
      ),
    );
  await db
    .update(userIntegrations)
    .set({ isDefault: true })
    .where(and(accountPredicate(input), eq(userIntegrations.isDefault, false)));
  return true;
}

export async function expireComposioConnection(
  db: Database,
  composioConnectionId: string,
): Promise<boolean> {
  const result = await db.execute(
    sql`select public.webhooks_expire_composio_connection(${composioConnectionId}) as updated`,
  );
  return result.rows[0]?.["updated"] === true;
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
       set is_default = false
     where user_id = ${input.userId}
       and integration = ${input.integration}
       and is_default = true
       and lower(status) not in ('active', 'authorized', 'connected', 'enabled')
  `);
  await db.execute(sql`
    update ${userIntegrations}
       set is_default = true
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

async function requireIntegrationOwnership(
  db: Database,
  inputs: readonly UserIntegrationUpsertInput[],
): Promise<void> {
  const expected = new Map(inputs.map((input) => [input.composioConnectionId, input]));
  const rows = await db
    .select({
      composioConnectionId: userIntegrations.composioConnectionId,
      integration: userIntegrations.integration,
      userId: userIntegrations.userId,
    })
    .from(userIntegrations)
    .where(inArray(userIntegrations.composioConnectionId, [...expected.keys()]));
  if (
    rows.length !== inputs.length ||
    rows.some((row) => {
      const input = expected.get(row.composioConnectionId);
      return !input || input.userId !== row.userId || input.integration !== row.integration;
    })
  ) {
    throw new Error("Composio connection ownership invariant violated");
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
