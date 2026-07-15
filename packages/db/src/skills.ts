import { MAX_USER_SKILLS, UserId as toUserId, type UserId } from "@cheatcode/types";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
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

export type UserSkillSummaryRecord = Omit<UserSkillRecord, "body" | "userId">;

export class UserSkillLimitExceededError extends Error {
  public constructor() {
    super(`A user can store at most ${MAX_USER_SKILLS} live custom skills.`);
    this.name = "UserSkillLimitExceededError";
  }
}

const USER_SKILL_SUMMARY_COLUMNS = {
  category: userSkills.category,
  createdAt: userSkills.createdAt,
  description: userSkills.description,
  id: userSkills.id,
  name: userSkills.name,
  tags: userSkills.tags,
  updatedAt: userSkills.updatedAt,
} as const;

const USER_SKILL_COLUMNS = {
  ...USER_SKILL_SUMMARY_COLUMNS,
  body: userSkills.body,
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

/** Bounded, body-less skill catalog used by the UI and every run's system prompt. */
export async function listUserSkillSummaries(
  db: Database,
  userId: UserId,
): Promise<UserSkillSummaryRecord[]> {
  const rows = await db
    .select(USER_SKILL_SUMMARY_COLUMNS)
    .from(userSkills)
    .where(and(eq(userSkills.userId, userId), isNull(userSkills.deletedAt)))
    .orderBy(desc(userSkills.updatedAt), desc(userSkills.id))
    .limit(MAX_USER_SKILLS);
  return rows;
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
  return db.transaction(async (transaction) => {
    const tx = transaction as Database;
    await lockUserSkillCatalog(tx, input.userId);
    const existing = await getUserSkillByName(tx, input.userId, input.name);
    if (existing) {
      return updateExistingUserSkill(tx, existing.id, input);
    }
    await requireUserSkillCapacity(tx, input.userId);
    return insertUserSkill(tx, input);
  });
}

async function updateExistingUserSkill(
  db: Database,
  id: string,
  input: UpsertUserSkillInput,
): Promise<UserSkillRecord> {
  const rows = await db
    .update(userSkills)
    .set({
      body: input.body,
      category: input.category,
      description: input.description,
      tags: input.tags,
      updatedAt: new Date(),
    })
    .where(and(eq(userSkills.id, id), eq(userSkills.userId, input.userId)))
    .returning(USER_SKILL_COLUMNS);
  return requiredSkillRow(rows[0], "update");
}

async function insertUserSkill(
  db: Database,
  input: UpsertUserSkillInput,
): Promise<UserSkillRecord> {
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
  return requiredSkillRow(rows[0], "create");
}

function requiredSkillRow(
  row: Parameters<typeof fromRow>[0] | undefined,
  operation: "create" | "update",
): UserSkillRecord {
  if (!row) {
    throw new Error(`Failed to ${operation} user skill`);
  }
  return fromRow(row);
}

async function lockUserSkillCatalog(db: Database, userId: UserId): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`user-skill-catalog:${userId}`}, 0))`,
  );
}

async function requireUserSkillCapacity(db: Database, userId: UserId): Promise<void> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userSkills)
    .where(and(eq(userSkills.userId, userId), isNull(userSkills.deletedAt)));
  if ((row?.count ?? 0) >= MAX_USER_SKILLS) {
    throw new UserSkillLimitExceededError();
  }
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
