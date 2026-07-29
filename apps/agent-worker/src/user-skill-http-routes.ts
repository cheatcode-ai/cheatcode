import { deleteUserSkill, getUserSkillById, type UserSkillRecord, withUserDb } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { UserId } from "@cheatcode/types";
import { SandboxIdeSessionSchema } from "@cheatcode/types/api";
import { AGENT_FORWARD_ROUTES } from "@cheatcode/types/internal";
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
  const { deleteUserSkill: deleteUserSkillRoute } = AGENT_FORWARD_ROUTES.core;
  const { openUserSkill: openUserSkillRoute } = AGENT_FORWARD_ROUTES.piped;
  app.on(openUserSkillRoute.method, openUserSkillRoute.path, openUserSkill);
  app.on(deleteUserSkillRoute.method, deleteUserSkillRoute.path, deleteSavedUserSkill);
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
  return withUserDb(env, userId, async ({ transaction }) => {
    return await transaction((tx) => getUserSkillById(tx, userId, skillId));
  });
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
  return withUserDb(env, userId, async ({ transaction }) => {
    const deleted = await transaction((tx) => deleteUserSkill(tx, userId, skillId));
    if (!deleted) {
      throw new APIError(404, "not_found_skill", "Skill not found", { retriable: false });
    }
  });
}

function parsedId(value: string | undefined, label: string): string {
  const parsed = IdSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", `Invalid ${label} id`, { retriable: false });
  }
  return parsed.data;
}
