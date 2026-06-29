import type { UserId } from "@cheatcode/types";
import { UserId as toUserId } from "@cheatcode/types";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "./client";
import { userSkills } from "./schema";

/** A user-created skill row. `body` is the full markdown procedure for `skill_invoke`. */
export interface UserSkillRecord {
  id: string;
  userId: UserId;
  name: string;
  description: string;
  category: string;
  tags: string[];
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

const USER_SKILL_COLUMNS = {
  body: userSkills.body,
  category: userSkills.category,
  createdAt: userSkills.createdAt,
  description: userSkills.description,
  id: userSkills.id,
  name: userSkills.name,
  tags: userSkills.tags,
  updatedAt: userSkills.updatedAt,
  userId: userSkills.userId,
} as const;

function fromRow(row: {
  id: string;
  userId: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  body: string;
  createdAt: Date;
  updatedAt: Date;
}): UserSkillRecord {
  return {
    body: row.body,
    category: row.category,
    createdAt: row.createdAt,
    description: row.description,
    id: row.id,
    name: row.name,
    tags: row.tags,
    updatedAt: row.updatedAt,
    userId: toUserId(row.userId),
  };
}

/** All of the caller's live skills, newest-first. Runs inside `withUserContext`. */
export async function listUserSkills(db: Database, userId: UserId): Promise<UserSkillRecord[]> {
  const rows = await db
    .select(USER_SKILL_COLUMNS)
    .from(userSkills)
    .where(and(eq(userSkills.userId, userId), isNull(userSkills.deletedAt)))
    .orderBy(desc(userSkills.updatedAt));
  return rows.map(fromRow);
}

/** One of the caller's live skills by name (used by `skill_invoke` for user skills). */
export async function getUserSkillByName(
  db: Database,
  userId: UserId,
  name: string,
): Promise<UserSkillRecord | null> {
  const rows = await db
    .select(USER_SKILL_COLUMNS)
    .from(userSkills)
    .where(
      and(eq(userSkills.userId, userId), eq(userSkills.name, name), isNull(userSkills.deletedAt)),
    )
    .limit(1);
  const row = rows[0];
  return row ? fromRow(row) : null;
}

export interface UpsertUserSkillInput {
  userId: UserId;
  name: string;
  description: string;
  category: string;
  tags: string[];
  body: string;
}

/**
 * Create or update (by name) the caller's skill. The partial-unique index keeps one
 * live skill per (user, name), so re-creating the same name edits in place.
 */
export async function upsertUserSkill(
  db: Database,
  input: UpsertUserSkillInput,
): Promise<UserSkillRecord> {
  const existing = await getUserSkillByName(db, input.userId, input.name);
  if (existing) {
    const rows = await db
      .update(userSkills)
      .set({
        body: input.body,
        category: input.category,
        description: input.description,
        tags: input.tags,
        updatedAt: new Date(),
      })
      .where(and(eq(userSkills.id, existing.id), eq(userSkills.userId, input.userId)))
      .returning(USER_SKILL_COLUMNS);
    const row = rows[0];
    if (!row) {
      throw new Error("Failed to update user skill");
    }
    return fromRow(row);
  }
  const rows = await db
    .insert(userSkills)
    .values({
      body: input.body,
      category: input.category,
      description: input.description,
      name: input.name,
      tags: input.tags,
      userId: input.userId,
    })
    .returning(USER_SKILL_COLUMNS);
  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create user skill");
  }
  return fromRow(row);
}

/** Soft-delete one of the caller's skills. Returns the deleted id, or null if not found. */
export async function deleteUserSkill(
  db: Database,
  userId: UserId,
  id: string,
): Promise<string | null> {
  const rows = await db
    .update(userSkills)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId), isNull(userSkills.deletedAt)))
    .returning({ id: userSkills.id });
  return rows[0]?.id ?? null;
}
