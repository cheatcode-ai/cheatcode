import {
  createDb,
  deleteUserSkill,
  listUserSkillSummaries,
  UserSkillLimitExceededError,
  type UserSkillSummaryRecord,
  upsertUserSkill,
  withUserContext,
} from "@cheatcode/db";
import { APIError, readJsonRequest } from "@cheatcode/observability";
import {
  CreateUserSkillSchema,
  type UserId,
  UserSkillSchema,
  UserSkillsResponseSchema,
} from "@cheatcode/types";
import { z } from "zod";
import type { GatewayEnv } from "./gateway-env";
import type { WaitUntilContext } from "./wait-until-context";

const IdParamSchema = z.string().uuid();
const MAX_SKILL_REQUEST_BYTES = 64 * 1024;
function skillSummary(record: UserSkillSummaryRecord): unknown {
  return UserSkillSchema.parse({
    category: record.category,
    createdAt: record.createdAt.toISOString(),
    description: record.description,
    id: record.id,
    name: record.name,
    tags: record.tags,
    updatedAt: record.updatedAt.toISOString(),
  });
}

/** `GET /v1/skills` — the caller's custom skills (body-less summaries). */
export async function listUserSkillsRoute(
  env: GatewayEnv,
  ctx: WaitUntilContext,
  userId: UserId,
): Promise<Response> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const rows = await withUserContext(db, userId, (tx) => listUserSkillSummaries(tx, userId));
    return Response.json(UserSkillsResponseSchema.parse({ skills: rows.map(skillSummary) }));
  } finally {
    ctx.waitUntil(close());
  }
}

/**
 * `POST /v1/skills` — create or update (by name) a custom skill. Used by the agent's
 * `skill_create` tool path and the manual creation form.
 */
export async function createUserSkillRoute(
  env: GatewayEnv,
  ctx: WaitUntilContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const parsed = CreateUserSkillSchema.safeParse(
    await readJsonRequest(request, MAX_SKILL_REQUEST_BYTES, "Skill request"),
  );
  if (!parsed.success) {
    throw new APIError(400, "invalid_request_body", "Invalid skill payload", {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  const input = parsed.data;
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const record = await withUserContext(db, userId, (tx) =>
      upsertUserSkill(tx, { ...input, userId }),
    );
    return Response.json(skillSummary(record), { status: 201 });
  } catch (error) {
    if (error instanceof UserSkillLimitExceededError) {
      throw new APIError(409, "conflict_state_invalid", error.message, {
        hint: "Delete an existing custom skill before creating another.",
        retriable: false,
      });
    }
    throw error;
  } finally {
    ctx.waitUntil(close());
  }
}

/** `DELETE /v1/skills/:id` — soft-delete a custom skill the caller owns. */
export async function deleteUserSkillRoute(
  env: GatewayEnv,
  ctx: WaitUntilContext,
  userId: UserId,
  skillId: string,
): Promise<Response> {
  const parsed = IdParamSchema.safeParse(skillId);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", "Invalid skill id", { retriable: false });
  }
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const deleted = await withUserContext(db, userId, (tx) =>
      deleteUserSkill(tx, userId, parsed.data),
    );
    if (!deleted) {
      throw new APIError(404, "not_found_skill", "Skill not found", { retriable: false });
    }
    return new Response(null, { status: 204 });
  } finally {
    ctx.waitUntil(close());
  }
}
