import type { UserSkillLoader, UserSkillRuntime, UserSkillStore } from "@cheatcode/agent-core";
import {
  createDb,
  getUserSkillByName,
  listUserSkillSummaries,
  upsertUserSkill,
  withUserContext,
} from "@cheatcode/db";
import { UserId } from "@cheatcode/types";
import type { AgentRunEnv } from "./agent-run-env";

export interface ResolvedUserSkillContext {
  userSkills: UserSkillRuntime[];
  userSkillLoader: UserSkillLoader;
  userSkillStore: UserSkillStore;
}

const DEFAULT_SKILL_CATEGORY = "Builder & Apps";

/**
 * Loads the user's custom skills for the run (so the agent can `skill_invoke` them)
 * and builds the `skill_create` persistence store the Skill Creator path uses. Each
 * is a request-scoped capability injected into the Mastra request context.
 */
export async function resolveUserSkillContext(
  env: AgentRunEnv,
  userIdRaw: string,
): Promise<ResolvedUserSkillContext> {
  const userId = UserId(userIdRaw);
  const userSkills = await readUserSkills(env, userId);
  const userSkillLoader: UserSkillLoader = {
    load: async (name) => {
      const { db, close } = createDb(env.HYPERDRIVE);
      try {
        const skill = await withUserContext(db, userId, (tx) =>
          getUserSkillByName(tx, userId, name),
        );
        return skill
          ? {
              body: skill.body,
              category: skill.category,
              description: skill.description,
              name: skill.name,
            }
          : null;
      } finally {
        await close();
      }
    },
  };
  const userSkillStore: UserSkillStore = {
    save: async (skill) => {
      const { db, close } = createDb(env.HYPERDRIVE);
      try {
        await withUserContext(db, userId, (tx) =>
          upsertUserSkill(tx, {
            body: skill.body,
            category: skill.category ?? DEFAULT_SKILL_CATEGORY,
            description: skill.description,
            name: skill.name,
            tags: skill.tags ?? [],
            userId,
          }),
        );
      } finally {
        await close();
      }
    },
  };
  return { userSkills, userSkillLoader, userSkillStore };
}

async function readUserSkills(env: AgentRunEnv, userId: UserId): Promise<UserSkillRuntime[]> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const rows = await withUserContext(db, userId, (tx) => listUserSkillSummaries(tx, userId));
    return rows.map((row) => ({
      category: row.category,
      description: row.description,
      name: row.name,
    }));
  } finally {
    await close();
  }
}
