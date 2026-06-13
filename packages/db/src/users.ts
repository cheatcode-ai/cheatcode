import type { UserId } from "@cheatcode/types";
import { UserId as toUserId } from "@cheatcode/types";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { entitlements, users } from "./schema";

export interface ClerkUserUpsert {
  avatarUrl?: string | null;
  clerkId: string;
  displayName?: string | null;
  email: string;
  webhookEventId?: string;
}

export interface ClerkUserUpsertResult {
  avatarUrl: string | null;
  displayName: string | null;
  email: string;
  emailChanged: boolean;
  profileChanged: boolean;
  polarCustomerId: string | null;
  userId: UserId;
}

export async function resolveInternalUserId(db: Database, clerkId: string): Promise<UserId | null> {
  const row = await db.query.users.findFirst({
    columns: { id: true },
    where: and(eq(users.clerkId, clerkId), isNull(users.deletedAt)),
  });

  return row ? toUserId(row.id) : null;
}

export async function upsertClerkUser(
  db: Database,
  input: ClerkUserUpsert,
): Promise<ClerkUserUpsertResult> {
  const existing = await db.query.users.findFirst({
    columns: {
      avatarUrl: true,
      displayName: true,
      email: true,
      polarCustomerId: true,
    },
    where: eq(users.clerkId, input.clerkId),
  });
  const displayName = normalizedNullable(input.displayName);
  const avatarUrl = normalizedNullable(input.avatarUrl);
  const rows = await db
    .insert(users)
    .values({
      avatarUrl,
      clerkId: input.clerkId,
      displayName,
      email: input.email,
      deletedAt: null,
    })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: {
        avatarUrl,
        displayName,
        email: input.email,
        deletedAt: null,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      avatarUrl: users.avatarUrl,
      displayName: users.displayName,
      email: users.email,
      id: users.id,
      polarCustomerId: users.polarCustomerId,
    });

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to upsert Clerk user");
  }

  const userId = toUserId(row.id);
  await db
    .insert(entitlements)
    .values({
      userId,
      tier: "free",
      source: "clerk",
      ...(input.webhookEventId ? { webhookEventId: input.webhookEventId } : {}),
    })
    .onConflictDoNothing();

  return {
    avatarUrl: row.avatarUrl,
    displayName: row.displayName,
    email: row.email,
    emailChanged: Boolean(existing && existing.email !== row.email),
    polarCustomerId: row.polarCustomerId,
    profileChanged: Boolean(
      existing &&
        (existing.email !== row.email ||
          existing.displayName !== row.displayName ||
          existing.avatarUrl !== row.avatarUrl),
    ),
    userId,
  };
}

export async function markClerkUserDeleted(db: Database, clerkId: string): Promise<UserId | null> {
  const rows = await db
    .update(users)
    .set({
      deletedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(users.clerkId, clerkId))
    .returning({ id: users.id });

  const row = rows[0];
  return row ? toUserId(row.id) : null;
}

function normalizedNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
