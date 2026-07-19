import {
  createDb,
  deleteUserSkill,
  getUserSkillById,
  type UserSkillRecord,
  withUserContext,
} from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { SandboxIdeSessionSchema, UserId } from "@cheatcode/types";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AgentEnv } from "./agent-env";
import { sandboxForUser } from "./agent-routing";
import { terminalDisplayCwd } from "./sandbox-route-helpers";
import { readGatewayUserId } from "./tenancy";
import { userSkillDirectoryPath, writeUserSkillMirror } from "./user-skill-files";
import {
  deleteUserSkillPackage,
  readUserSkillPackage,
  writeUserSkillPackageMirror,
} from "./user-skill-packages";

const IdSchema = z.string().uuid();
type AgentContext = Context<{ Bindings: AgentEnv }>;

export function registerUserSkillHttpRoutes(app: Hono<{ Bindings: AgentEnv }>): void {
  app.post("/v1/skills/:skillId/open", openUserSkill);
  app.delete("/v1/skills/:skillId", deleteSavedUserSkill);
}

async function deleteSavedUserSkill(c: AgentContext): Promise<Response> {
  const userId = UserId(readGatewayUserId(c.req.raw.headers));
  const skillId = parsedId(c.req.param("skillId"), "skill");
  const skill = await readSkill(c.env, userId, skillId);
  if (!skill) {
    throw new APIError(404, "not_found_skill", "Skill not found", { retriable: false });
  }
  await removeSkillPackageFiles(c.env, userId, skill);
  await deleteSkillRecord(c.env, userId, skillId);
  return new Response(null, { status: 204 });
}

async function openUserSkill(c: AgentContext): Promise<Response> {
  const userId = UserId(readGatewayUserId(c.req.raw.headers));
  const skillId = parsedId(c.req.param("skillId"), "skill");
  const skill = await readSkill(c.env, userId, skillId);
  if (!skill) {
    throw new APIError(404, "not_found_skill", "Skill not found", { retriable: false });
  }
  const filePath = await mirrorSkillPackage(c.env, userId, skill);
  const sandbox = await sandboxForUser(c.env, userId);
  const session = await sandbox.exposeCodeServer({
    initialFilePath: filePath,
    workspacePath: userSkillDirectoryPath(skill.name),
  });
  return c.json(
    SandboxIdeSessionSchema.parse({
      ...session,
      displayWorkspacePath: terminalDisplayCwd(session.workspacePath),
    }),
  );
}

async function mirrorSkillPackage(
  env: AgentEnv,
  userId: UserId,
  skill: UserSkillRecord,
): Promise<string> {
  const packageValue = await readUserSkillPackage(env.R2_OUTPUTS, userId, skill.id);
  const sandbox = await sandboxForUser(env, userId);
  return packageValue
    ? writeUserSkillPackageMirror(sandbox, skill, packageValue)
    : writeUserSkillMirror(sandbox, skill);
}

async function readSkill(
  env: AgentEnv,
  userId: UserId,
  skillId: string,
): Promise<UserSkillRecord | null> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    return await withUserContext(db, userId, (tx) => getUserSkillById(tx, userId, skillId));
  } finally {
    await close();
  }
}

async function removeSkillPackageFiles(
  env: AgentEnv,
  userId: UserId,
  skill: UserSkillRecord,
): Promise<void> {
  const sandbox = await sandboxForUser(env, userId);
  if (!sandbox.deleteFile) {
    throw new APIError(
      503,
      "unavailable_maintenance",
      "The skill workspace cannot be cleaned up right now",
      { retriable: true },
    );
  }
  await Promise.all([
    deleteUserSkillPackage(env.R2_OUTPUTS, userId, skill.id),
    sandbox.deleteFile({ path: userSkillDirectoryPath(skill.name), recursive: true }),
  ]);
}

async function deleteSkillRecord(env: AgentEnv, userId: UserId, skillId: string): Promise<void> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const deleted = await withUserContext(db, userId, (tx) => deleteUserSkill(tx, userId, skillId));
    if (!deleted) {
      throw new APIError(404, "not_found_skill", "Skill not found", { retriable: false });
    }
  } finally {
    await close();
  }
}

function parsedId(value: string | undefined, label: string): string {
  const parsed = IdSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", `Invalid ${label} id`, { retriable: false });
  }
  return parsed.data;
}
