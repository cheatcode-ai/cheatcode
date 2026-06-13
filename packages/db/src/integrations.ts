import { UserId } from "@cheatcode/types";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import { userIntegrations } from "./schema";

export interface UserIntegrationRecord {
  composioConnectionId: string;
  connectedAt: Date;
  integration: string;
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
  await db
    .insert(userIntegrations)
    .values({
      composioConnectionId: input.composioConnectionId,
      integration: input.integration,
      status: input.status,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      target: [userIntegrations.userId, userIntegrations.integration],
      set: {
        composioConnectionId: input.composioConnectionId,
        status: input.status,
        updatedAt: sql`now()`,
      },
    });
}

export async function listUserIntegrations(
  db: Database,
  userId: UserId,
): Promise<UserIntegrationRecord[]> {
  const rows = await db
    .select({
      composioConnectionId: userIntegrations.composioConnectionId,
      connectedAt: userIntegrations.connectedAt,
      integration: userIntegrations.integration,
      status: userIntegrations.status,
      updatedAt: userIntegrations.updatedAt,
      userId: userIntegrations.userId,
    })
    .from(userIntegrations)
    .where(eq(userIntegrations.userId, userId));
  return rows.map(toUserIntegrationRecord);
}

export async function findUserIntegration(
  db: Database,
  input: { integration: string; userId: UserId },
): Promise<UserIntegrationRecord | null> {
  const rows = await db
    .select({
      composioConnectionId: userIntegrations.composioConnectionId,
      connectedAt: userIntegrations.connectedAt,
      integration: userIntegrations.integration,
      status: userIntegrations.status,
      updatedAt: userIntegrations.updatedAt,
      userId: userIntegrations.userId,
    })
    .from(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, input.userId),
        eq(userIntegrations.integration, input.integration),
      ),
    )
    .limit(1);
  return rows[0] ? toUserIntegrationRecord(rows[0]) : null;
}

function toUserIntegrationRecord(row: {
  composioConnectionId: string;
  connectedAt: Date;
  integration: string;
  status: string;
  updatedAt: Date;
  userId: string;
}): UserIntegrationRecord {
  return {
    composioConnectionId: row.composioConnectionId,
    connectedAt: row.connectedAt,
    integration: row.integration,
    status: row.status,
    updatedAt: row.updatedAt,
    userId: UserId(row.userId),
  };
}

export async function updateUserIntegrationStatusByConnectionId(
  db: Database,
  input: { composioConnectionId: string; status: string },
): Promise<boolean> {
  const rows = await db
    .update(userIntegrations)
    .set({ status: input.status, updatedAt: sql`now()` })
    .where(eq(userIntegrations.composioConnectionId, input.composioConnectionId))
    .returning({ composioConnectionId: userIntegrations.composioConnectionId });
  return rows.length > 0;
}

export async function deleteUserIntegration(
  db: Database,
  input: { integration: string; userId: UserId },
): Promise<void> {
  await db
    .delete(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, input.userId),
        eq(userIntegrations.integration, input.integration),
      ),
    );
}
