import {
  createDb,
  listUserSkillSummaries,
  type UserSkillSummaryRecord,
  withUserContext,
} from "@cheatcode/db";
import { type UserId, UserSkillSchema, UserSkillsResponseSchema } from "@cheatcode/types";
import type { GatewayEnv } from "./gateway-env";
import type { WaitUntilContext } from "./wait-until-context";

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
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const rows = await withUserContext(db, userId, (tx) => listUserSkillSummaries(tx, userId));
    return Response.json(UserSkillsResponseSchema.parse({ skills: rows.map(skillSummary) }));
  } finally {
    ctx.waitUntil(close());
  }
}
