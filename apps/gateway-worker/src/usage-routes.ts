import { createDb, listUsageDailyTotals, withUserContext } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import {
  UsageDailyQuerySchema,
  type UsageDailyTotalsResponse,
  UsageDailyTotalsResponseSchema,
  type UserId,
} from "@cheatcode/types";
import type { z } from "zod";

export interface UsageRouteEnv {
  HYPERDRIVE: Hyperdrive;
}

export async function listUsageDailyRoute(
  env: UsageRouteEnv,
  ctx: ExecutionContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const query = parseUsageDailyQuery(request);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const totals = await withUserContext(db, userId, (tx) =>
      listUsageDailyTotals(tx, { days: query.days, userId }),
    );
    return Response.json(UsageDailyTotalsResponseSchema.parse(usageResponse(query.days, totals)));
  } finally {
    ctx.waitUntil(close());
  }
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

function usageResponse(
  days: number,
  rows: Awaited<ReturnType<typeof listUsageDailyTotals>>,
): UsageDailyTotalsResponse {
  return {
    days,
    totals: rows.map((row) => ({
      agentRunCount: row.agentRunCount,
      day: row.day,
      totalCachedTokens: row.totalCachedTokens,
      totalCostUsd: Number(row.totalCostUsd),
      totalInputTokens: row.totalInputTokens,
      totalOutputTokens: row.totalOutputTokens,
    })),
  };
}

function invalidQueryParam(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_query_param", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}
