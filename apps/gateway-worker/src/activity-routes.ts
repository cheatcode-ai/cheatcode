import {
  type AgentRunStartPointRange,
  createDb,
  type Database,
  listAgentRunStartPoints,
  withUserContext,
} from "@cheatcode/db";
import { APIError, readBoundedResponseJson } from "@cheatcode/observability";
import {
  type ActivityHistoryResponse,
  ActivityHistoryResponseSchema,
  ActivityQuerySchema,
  type UserId,
} from "@cheatcode/types";
import { QUOTA_FEATURES } from "@cheatcode/types/quota";
import type { z } from "zod";
import type { QuotaTracker } from "./durable-objects/quota-tracker";
import { QuotaHistoryResultSchema } from "./durable-objects/quota-tracker-contract";
import type { WaitUntilContext } from "./wait-until-context";

export interface ActivityRouteEnv {
  HYPERDRIVE: Hyperdrive;
  QUOTA_TRACKER: DurableObjectNamespace<QuotaTracker>;
}

const MS_PER_DAY = 86_400_000;
/** Punchcard dots returned to the client; rows beyond this set `truncated`. */
const RUN_POINT_DISPLAY_CAP = 2_000;
/** Request one past the display cap so a clipped range is detectable. */
const RUN_POINT_REQUEST_LIMIT = RUN_POINT_DISPLAY_CAP + 1;
const MAX_QUOTA_HISTORY_RESPONSE_BYTES = 64 * 1024;

export async function getActivityHistoryRoute(
  env: ActivityRouteEnv,
  ctx: WaitUntilContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const query = parseActivityQuery(request);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const sandboxHours = await listSandboxHourHistory(env, userId, query.days);
    const response = await withUserContext(db, userId, (tx) =>
      buildActivityResponse(tx, userId, query.days),
    );
    response.sandboxHours = sandboxHours;
    return Response.json(ActivityHistoryResponseSchema.parse(response));
  } finally {
    ctx.waitUntil(close());
  }
}

async function buildActivityResponse(
  db: Database,
  userId: UserId,
  days: number,
): Promise<ActivityHistoryResponse> {
  const runPoints = await listAgentRunStartPoints(db, userId, runPointRange(days));
  const truncated = runPoints.length > RUN_POINT_DISPLAY_CAP;
  return {
    days,
    runs: truncated ? runPoints.slice(0, RUN_POINT_DISPLAY_CAP) : runPoints,
    sandboxHours: [],
    truncated,
  };
}

async function listSandboxHourHistory(env: ActivityRouteEnv, userId: UserId, days: number) {
  const stub = env.QUOTA_TRACKER.get(env.QUOTA_TRACKER.idFromName(`quota:${userId}`));
  const response = await stub.fetch("https://quota.internal/history", {
    body: JSON.stringify({
      feature: QUOTA_FEATURES.sandboxHours,
      from: new Date(Date.now() - days * MS_PER_DAY).toISOString(),
    }),
    method: "POST",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new APIError(503, "unavailable_maintenance", "Sandbox activity is unavailable", {
      retriable: true,
    });
  }
  return QuotaHistoryResultSchema.parse(
    await readBoundedResponseJson(response, MAX_QUOTA_HISTORY_RESPONSE_BYTES, "Quota history"),
  ).map((point) => ({
    hours: point.amount,
    recordedAt: new Date(point.recordedAt).toISOString(),
  }));
}

function runPointRange(days: number): AgentRunStartPointRange {
  const to = new Date();
  return { from: new Date(to.getTime() - days * MS_PER_DAY), limit: RUN_POINT_REQUEST_LIMIT, to };
}

function parseActivityQuery(request: Request): { days: number } {
  const url = new URL(request.url);
  const parsed = ActivityQuerySchema.safeParse({
    days: url.searchParams.get("days") ?? undefined,
  });
  if (!parsed.success) {
    throw invalidQueryParam("Invalid activity query", parsed.error);
  }
  return parsed.data;
}

function invalidQueryParam(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_query_param", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}
