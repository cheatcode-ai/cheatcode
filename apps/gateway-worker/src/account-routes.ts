import { createDb, getUserAccount, updateUserAccount, withUserContext } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { MeResponseSchema, UpdateMeSchema, type UserId } from "@cheatcode/types";

export interface AccountRouteEnv {
  HYPERDRIVE: Hyperdrive;
}

function accountResponse(record: {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}) {
  return MeResponseSchema.parse({
    avatarUrl: record.avatarUrl,
    displayName: record.displayName,
    email: record.email,
    id: record.id,
  });
}

export async function getMeRoute(
  env: AccountRouteEnv,
  ctx: ExecutionContext,
  userId: UserId,
): Promise<Response> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const record = await withUserContext(db, userId, (tx) => getUserAccount(tx, userId));
    if (!record) {
      throw new APIError(404, "not_found_user", "User not found", { retriable: false });
    }
    return Response.json(accountResponse(record));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function updateMeRoute(
  env: AccountRouteEnv,
  ctx: ExecutionContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const parsed = UpdateMeSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new APIError(400, "invalid_request_body", "Invalid account payload", {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const record = await withUserContext(db, userId, (tx) =>
      updateUserAccount(tx, userId, {
        ...(parsed.data.displayName === undefined ? {} : { displayName: parsed.data.displayName }),
      }),
    );
    if (!record) {
      throw new APIError(404, "not_found_user", "User not found", { retriable: false });
    }
    return Response.json(accountResponse(record));
  } finally {
    ctx.waitUntil(close());
  }
}
