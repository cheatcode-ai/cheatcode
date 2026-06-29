import {
  createDb,
  findActiveReplayShareByThread,
  getThread,
  getUserAccount,
  type ReplayShareRecord,
  updateReplayShare,
  upsertReplayShare,
  withUserContext,
} from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import {
  CreateReplayShareSchema,
  ReplayShareSchema,
  ThreadId,
  type ThreadId as ThreadIdType,
  UpdateReplayShareSchema,
  type UserId,
} from "@cheatcode/types";
import { z } from "zod";
import type { GatewayEnv } from "./index";

const IdParamSchema = z.string().uuid();
const DEFAULT_SHARE_AUTHOR = "A Cheatcode builder";
const SHARE_TITLE_MAX = 200;

function invalidBody(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_request_body", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}

function notFound(message: string): APIError {
  return new APIError(404, "not_found_replay", message, { retriable: false });
}

function shareResponse(record: ReplayShareRecord): unknown {
  return ReplayShareSchema.parse({
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    revoked: record.revokedAt !== null,
    threadId: record.threadId,
    visibility: record.visibility,
  });
}

/**
 * `POST /v1/replays` — publish one of the caller's own runs as a read-only replay.
 * Idempotent: returns the existing active share for the thread if one exists. The
 * run title + author name are snapshotted so the public read path needs no
 * cross-user lookup.
 */
export async function createReplayShareRoute(
  env: GatewayEnv,
  ctx: ExecutionContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const parsed = CreateReplayShareSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw invalidBody("Invalid replay share payload", parsed.error);
  }
  const input = parsed.data;
  const threadId = ThreadId(input.threadId);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const record = await withUserContext(db, userId, async (tx) => {
      const thread = await getThread(tx, { threadId, userId });
      if (!thread) {
        throw notFound("Run not found");
      }
      const account = await getUserAccount(tx, userId);
      const share = await upsertReplayShare(tx, {
        authorName: account?.displayName?.trim() || DEFAULT_SHARE_AUTHOR,
        threadId,
        title: shareTitle(thread.title),
        userId,
      });
      // Honor an explicit non-default visibility on creation (e.g. publishing public).
      if (input.visibility && input.visibility !== share.visibility) {
        const updated = await updateReplayShare(tx, {
          id: share.id,
          userId,
          visibility: input.visibility,
        });
        return updated ?? share;
      }
      return share;
    });
    return Response.json(shareResponse(record), { status: 201 });
  } finally {
    ctx.waitUntil(close());
  }
}

/**
 * `GET /v1/threads/:threadId/replay-share` — the caller's active share for this run,
 * or `{ share: null }`. Lets the share dialog show the existing link + revoke on open.
 */
export async function getThreadReplayShareRoute(
  env: GatewayEnv,
  ctx: ExecutionContext,
  userId: UserId,
  rawThreadId: string,
): Promise<Response> {
  const threadId = parseThreadId(rawThreadId);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const record = await withUserContext(db, userId, (tx) =>
      findActiveReplayShareByThread(tx, { threadId, userId }),
    );
    return Response.json({ share: record ? shareResponse(record) : null });
  } finally {
    ctx.waitUntil(close());
  }
}

/**
 * `PATCH /v1/replays/:id` — change visibility and/or revoke a share the caller owns.
 */
export async function updateReplayShareRoute(
  env: GatewayEnv,
  ctx: ExecutionContext,
  request: Request,
  userId: UserId,
  shareId: string,
): Promise<Response> {
  const id = parseShareId(shareId);
  const parsed = UpdateReplayShareSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw invalidBody("Invalid replay share payload", parsed.error);
  }
  const patch = parsed.data;
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const record = await withUserContext(db, userId, (tx) =>
      updateReplayShare(tx, {
        id,
        userId,
        ...(patch.revoke === undefined ? {} : { revoke: patch.revoke }),
        ...(patch.visibility === undefined ? {} : { visibility: patch.visibility }),
      }),
    );
    if (!record) {
      throw notFound("Replay share not found");
    }
    return Response.json(shareResponse(record));
  } finally {
    ctx.waitUntil(close());
  }
}

function parseShareId(value: string): string {
  const parsed = IdParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", "Invalid replay share id", { retriable: false });
  }
  return parsed.data;
}

function parseThreadId(value: string): ThreadIdType {
  const parsed = IdParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", "Invalid thread id", { retriable: false });
  }
  return ThreadId(parsed.data);
}

function shareTitle(title: string | null): string {
  const trimmed = (title ?? "").trim();
  if (trimmed.length === 0) {
    return "Shared run";
  }
  return trimmed.length > SHARE_TITLE_MAX ? trimmed.slice(0, SHARE_TITLE_MAX) : trimmed;
}
