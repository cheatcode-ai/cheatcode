import {
  type AgentRunStartPointRange,
  createDb,
  type Database,
  listAgentRunStartPoints,
  listUsageDailyTotals,
  withUserContext,
} from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import {
  UsageDailyQuerySchema,
  type UsageDailyTotal,
  type UsageDailyTotalsResponse,
  UsageDailyTotalsResponseSchema,
  type UserId,
} from "@cheatcode/types";
import type { z } from "zod";

export interface UsageRouteEnv {
  HYPERDRIVE: Hyperdrive;
}

const MS_PER_DAY = 86_400_000;
/** Punchcard dots returned to the client; rows beyond this set `truncated`. */
const RUN_POINT_DISPLAY_CAP = 2_000;
/** Request one past the display cap so a clipped range is detectable. */
const RUN_POINT_REQUEST_LIMIT = RUN_POINT_DISPLAY_CAP + 1;

export async function listUsageDailyRoute(
  env: UsageRouteEnv,
  ctx: ExecutionContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const query = parseUsageDailyQuery(request);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const response = await withUserContext(db, userId, (tx) =>
      buildUsageDailyResponse(tx, userId, query.days),
    );
    return Response.json(UsageDailyTotalsResponseSchema.parse(response));
  } finally {
    ctx.waitUntil(close());
  }
}

async function buildUsageDailyResponse(
  db: Database,
  userId: UserId,
  days: number,
): Promise<UsageDailyTotalsResponse> {
  const [totals, runPoints] = await Promise.all([
    listUsageDailyTotals(db, { days, userId }),
    listAgentRunStartPoints(db, userId, runPointRange(days)),
  ]);
  const truncated = runPoints.length > RUN_POINT_DISPLAY_CAP;
  return {
    days,
    runs: truncated ? runPoints.slice(0, RUN_POINT_DISPLAY_CAP) : runPoints,
    totals: totals.map(toDailyTotal),
    truncated,
  };
}

function runPointRange(days: number): AgentRunStartPointRange {
  const to = new Date();
  return { from: new Date(to.getTime() - days * MS_PER_DAY), limit: RUN_POINT_REQUEST_LIMIT, to };
}

function toDailyTotal(
  row: Awaited<ReturnType<typeof listUsageDailyTotals>>[number],
): UsageDailyTotal {
  return {
    agentRunCount: row.agentRunCount,
    day: row.day,
    totalCachedTokens: row.totalCachedTokens,
    totalCostUsd: Number(row.totalCostUsd),
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
  };
}

function parseUsageDailyQuery(request: Request): { days: number } {
  const url = new URL(request.url);
  const parsed = UsageDailyQuerySchema.safeParse({
    days: url.searchParams.get("days") ?? undefined,
  });
  if (!parsed.success) {
    throw invalidQueryParam("Invalid usage query", parsed.error);
  }
  return parsed.data;
}

function invalidQueryParam(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_query_param", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}
