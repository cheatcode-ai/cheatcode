import { sql } from "drizzle-orm";
import type { Database } from "./client";

const CLERK_IDENTITY_LOCK_NAMESPACE = "cheatcode:clerk-identity:";

/** A one-way stable identity used only for deletion fencing and tombstones. */
export async function clerkIdentityHash(clerkId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clerkId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Serialize Clerk upsert and final-delete decisions for one external identity. */
export async function lockClerkIdentity(db: Database, identityHash: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${CLERK_IDENTITY_LOCK_NAMESPACE}${identityHash}`}, 0))`,
  );
}
