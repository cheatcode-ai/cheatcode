import type {
  UserSkillCreateInput,
  UserSkillCreateResult,
  UserSkillCreator,
  UserSkillDefinition,
  UserSkillLoader,
  UserSkillRuntime,
} from "@cheatcode/agent-core";
import {
  createDb,
  getUserSkillByName,
  listUserSkillRecords,
  type UserSkillRecord,
  upsertUserSkill,
  withUserContext,
} from "@cheatcode/db";
import type { SandboxLike } from "@cheatcode/sandbox-contracts";
import { UserId } from "@cheatcode/types";
import {
  resolveUserSkillMirror,
  serializeUserSkillMarkdown,
  userSkillSlug,
  writeUserSkillMirror,
} from "../user-skill-files";
import {
  collectUserSkillPackageFromSandbox,
  persistUserSkillPackage,
  readUserSkillPackage,
  writeUserSkillPackageMirror,
} from "../user-skill-packages";
import type { AgentRunEnv } from "./agent-run-env";

export interface ResolvedUserSkillContext {
  userSkillCreator: UserSkillCreator;
  userSkills: UserSkillRuntime[];
  userSkillLoader: UserSkillLoader;
}

/**
 * Loads the user's custom skills for the run (so the agent can `skill_invoke` them)
 * and builds the request-scoped loader used by `skill_invoke`.
 */
export async function resolveUserSkillContext(
  env: AgentRunEnv,
  userIdRaw: string,
  sandbox: SandboxLike,
): Promise<ResolvedUserSkillContext> {
  const userId = UserId(userIdRaw);
  const skillRecords = await readUserSkills(env, userId);
  await projectUserSkillPackages(env, userId, sandbox, skillRecords);
  const userSkills = skillRecords.map(runtimeSkillSummary);
  const userSkillLoader: UserSkillLoader = {
    load: async (name) => loadUserSkill(env, userId, sandbox, name),
  };
  const userSkillCreator: UserSkillCreator = {
    create: async (input) => persistCreatedUserSkill(env, userId, sandbox, input),
  };
  return { userSkillCreator, userSkills, userSkillLoader };
}

async function persistCreatedUserSkill(
  env: AgentRunEnv,
  userId: UserId,
  sandbox: SandboxLike,
  input: UserSkillCreateInput,
): Promise<UserSkillCreateResult> {
  const skill = await saveUserSkillRecord(env, userId, input);
  const collected = await collectUserSkillPackageFromSandbox(sandbox, skill, input.sourceSlug);
  const canonicalMarkdown = await serializeUserSkillMarkdown(skill);
  const files = collected.some((file) => file.path === "SKILL.md")
    ? collected.map((file) =>
        file.path === "SKILL.md" ? { content: canonicalMarkdown, path: file.path } : file,
      )
    : [{ content: canonicalMarkdown, path: "SKILL.md" }, ...collected];
  const packageValue = await persistUserSkillPackage(env.R2_OUTPUTS, userId, skill.id, files);
  const filePath = await writeUserSkillPackageMirror(sandbox, skill, packageValue);
  return {
    description: skill.description,
    filePath,
    id: skill.id,
    name: skill.name,
    slug: userSkillSlug(skill.name),
  };
}

async function saveUserSkillRecord(
  env: AgentRunEnv,
  userId: UserId,
  input: UserSkillCreateInput,
): Promise<UserSkillRecord> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    return await withUserContext(db, userId, (tx) =>
      upsertUserSkill(tx, {
        body: input.body,
        category: input.category,
        description: input.description,
        name: input.name,
        tags: input.tags,
        userId,
      }),
    );
  } finally {
    await close();
  }
}

async function loadUserSkill(
  env: AgentRunEnv,
  userId: UserId,
  sandbox: SandboxLike,
  name: string,
): Promise<UserSkillDefinition | null> {
  const skill = await readUserSkill(env, userId, name);
  if (!skill) return null;
  const resolution = await resolveUserSkillMirror(sandbox, skill);
  const resolved =
    resolution.kind === "promote"
      ? await promoteUserSkillMirror(env, userId, sandbox, skill, resolution.mirror)
      : skill;
  return runtimeSkill(resolved);
}

async function readUserSkills(env: AgentRunEnv, userId: UserId): Promise<UserSkillRecord[]> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    return await withUserContext(db, userId, (tx) => listUserSkillRecords(tx, userId));
  } finally {
    await close();
  }
}

async function projectUserSkillPackages(
  env: AgentRunEnv,
  userId: UserId,
  sandbox: SandboxLike,
  skills: UserSkillRecord[],
): Promise<void> {
  for (const skill of skills) {
    const packageValue = await readUserSkillPackage(env.R2_OUTPUTS, userId, skill.id);
    if (packageValue) {
      await writeUserSkillPackageMirror(sandbox, skill, packageValue);
    } else {
      await writeUserSkillMirror(sandbox, skill);
    }
  }
}

async function readUserSkill(
  env: AgentRunEnv,
  userId: UserId,
  name: string,
): Promise<UserSkillRecord | null> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    return await withUserContext(db, userId, (tx) => getUserSkillByName(tx, userId, name));
  } finally {
    await close();
  }
}

async function promoteUserSkillMirror(
  env: AgentRunEnv,
  userId: UserId,
  sandbox: SandboxLike,
  skill: UserSkillRecord,
  mirror: {
    body: string;
    category: string;
    description: string;
    tags: string[];
  },
): Promise<UserSkillRecord> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const updated = await withUserContext(db, userId, (tx) =>
      upsertUserSkill(tx, {
        body: mirror.body,
        category: mirror.category,
        description: mirror.description,
        name: skill.name,
        tags: mirror.tags,
        userId,
      }),
    );
    await writeUserSkillMirror(sandbox, updated);
    return updated;
  } finally {
    await close();
  }
}

function runtimeSkill(skill: UserSkillRecord): UserSkillDefinition {
  return {
    body: skill.body,
    category: skill.category,
    description: skill.description,
    name: skill.name,
    rootPath: `/workspace/.cheatcode/skills/${userSkillSlug(skill.name)}`,
  };
}

function runtimeSkillSummary(skill: UserSkillRecord): UserSkillRuntime {
  return {
    category: skill.category,
    description: skill.description,
    name: skill.name,
  };
}
