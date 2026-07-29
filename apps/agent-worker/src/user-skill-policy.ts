/** Single authority for user-skill capacity policy, enforced inside withLockedUserSkillCatalog before insertUserSkill. */

import {
  countUserSkills,
  type Database,
  getUserSkillByName,
  type UpsertUserSkillInput,
  type UserSkillRecord,
  updateUserSkill,
  withLockedUserSkillCatalog,
} from "@cheatcode/db";
import { MAX_USER_SKILLS } from "@cheatcode/types";

class UserSkillLimitExceededError extends Error {
  public constructor() {
    super(`A user can store at most ${MAX_USER_SKILLS} live custom skills.`);
    this.name = "UserSkillLimitExceededError";
  }
}

/**
 * Create or update (by name) the caller's skill. The unique index keeps one
 * skill per (user, name), so re-creating the same name edits in place.
 */
export function upsertUserSkill(
  db: Database,
  input: UpsertUserSkillInput,
): Promise<UserSkillRecord> {
  return withLockedUserSkillCatalog(db, input.userId, async (transaction, insert) => {
    const existing = await getUserSkillByName(transaction, input.userId, input.name);
    if (existing) {
      return updateUserSkill(transaction, existing.id, input);
    }
    if ((await countUserSkills(transaction, input.userId)) >= MAX_USER_SKILLS) {
      throw new UserSkillLimitExceededError();
    }
    return insert(input);
  });
}
