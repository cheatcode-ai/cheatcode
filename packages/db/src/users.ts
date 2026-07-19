import type { UserId } from "@cheatcode/types";
import { UserId as toUserId } from "@cheatcode/types";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { users } from "./schema";

export interface ClerkUserSyncInput {
  avatarUrl?: string | null;
  clerkId: string;
  clerkUpdatedAtMs: number;
  displayName?: string | null;
  email: string;
}

export type ClerkUserSyncOutcome = "created" | "stale" | "unchanged" | "updated";

export interface ClerkUserSyncResult {
  avatarUrl: string | null;
  clerkUpdatedAtMs: number;
  displayName: string | null;
  email: string;
  emailChanged: boolean;
  outcome: ClerkUserSyncOutcome;
  profileChanged: boolean;
  polarCustomerId: string | null;
  userId: UserId;
}

export class UserDeletionBlockedError extends Error {
  public constructor(public readonly reason: "completed" | "in-progress" = "in-progress") {
    super(
      reason === "completed"
        ? "This Clerk identity was permanently retired"
        : "User deletion has entered its irreversible phase",
    );
    this.name = "UserDeletionBlockedError";
  }
}

export async function resolveInternalUserId(db: Database, clerkId: string): Promise<UserId | null> {
  const result = await db.execute(
    sql`select public.gateway_resolve_clerk_user(${clerkId}) as user_id`,
  );
  const userId = result.rows[0]?.["user_id"];
  return typeof userId === "string" ? toUserId(userId) : null;
}

/** Minimal agent-side admission check used before creating user-owned durable state. */
export async function isUserAccountActive(db: Database, userId: UserId): Promise<boolean> {
  const row = await db.query.users.findFirst({
    columns: { id: true },
    where: and(eq(users.id, userId), isNull(users.deletedAt), isNull(users.deletionFence)),
  });
  return row !== undefined;
}

export async function syncClerkUser(
  db: Database,
  input: ClerkUserSyncInput,
): Promise<ClerkUserSyncResult> {
  const result = await db.execute(sql`
    select * from public.sync_clerk_user(
      ${input.clerkId},
      ${input.email},
      ${input.displayName ?? null},
      ${input.avatarUrl ?? null},
      ${input.clerkUpdatedAtMs}
    )
  `);
  const row = result.rows[0] as ClerkUserSyncRow | undefined;
  if (!row || row.sync_state === "in_progress") {
    throw new UserDeletionBlockedError();
  }
  if (row.sync_state === "completed") {
    throw new UserDeletionBlockedError("completed");
  }
  if (!row.user_id || !row.email || !isClerkUserSyncOutcome(row.sync_state)) {
    throw new Error("Clerk user synchronization returned an invalid active record");
  }
  const clerkUpdatedAtMs = Number(row.clerk_updated_at_ms);
  if (!Number.isSafeInteger(clerkUpdatedAtMs) || clerkUpdatedAtMs < 0) {
    throw new Error("Clerk user synchronization returned an invalid source version");
  }
  return {
    avatarUrl: row.avatar_url,
    clerkUpdatedAtMs,
    displayName: row.display_name,
    email: row.email,
    emailChanged: row.email_changed,
    outcome: row.sync_state,
    polarCustomerId: row.polar_customer_id,
    profileChanged: row.profile_changed,
    userId: toUserId(row.user_id),
  };
}

function isClerkUserSyncOutcome(value: string): value is ClerkUserSyncOutcome {
  return value === "created" || value === "stale" || value === "unchanged" || value === "updated";
}

interface ClerkUserSyncRow {
  avatar_url: string | null;
  clerk_updated_at_ms: number | string | null;
  display_name: string | null;
  email: string | null;
  email_changed: boolean;
  polar_customer_id: string | null;
  profile_changed: boolean;
  sync_state: "completed" | "created" | "in_progress" | "stale" | "unchanged" | "updated";
  user_id: string | null;
}

export async function markClerkUserDeleted(
  db: Database,
  clerkId: string,
  deletedAt: Date,
): Promise<UserId | null> {
  const result = await db.execute(
    sql`select public.webhooks_mark_clerk_user_deleted(${clerkId}, ${deletedAt}) as user_id`,
  );
  const userId = result.rows[0]?.["user_id"];
  return typeof userId === "string" ? toUserId(userId) : null;
}
