import {
  createDb,
  deleteUserSkill,
  listUserSkills,
  type UserSkillRecord,
  upsertUserSkill,
  withUserContext,
} from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import {
  CreateUserSkillSchema,
  type UserId,
  UserSkillSchema,
  UserSkillsResponseSchema,
} from "@cheatcode/types";
import { z } from "zod";
import type { GatewayEnv } from "./index";

const IdParamSchema = z.string().uuid();
const DEFAULT_SKILL_CATEGORY = "Builder & Apps";

function skillSummary(record: UserSkillRecord): unknown {
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
  ctx: ExecutionContext,
  userId: UserId,
): Promise<Response> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const rows = await withUserContext(db, userId, (tx) => listUserSkills(tx, userId));
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
  ctx: ExecutionContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const parsed = CreateUserSkillSchema.safeParse(await request.json());
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
      upsertUserSkill(tx, {
        body: input.body,
        category: input.category ?? DEFAULT_SKILL_CATEGORY,
        description: input.description,
        name: input.name,
        tags: input.tags ?? [],
        userId,
      }),
    );
    return Response.json(skillSummary(record), { status: 201 });
  } finally {
    ctx.waitUntil(close());
  }
}

/** `DELETE /v1/skills/:id` — soft-delete a custom skill the caller owns. */
export async function deleteUserSkillRoute(
  env: GatewayEnv,
  ctx: ExecutionContext,
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
