import type { UserId } from "@cheatcode/types";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { Database } from "./client";
import { agentRuns } from "./schema";

/** Hard upper bound on returned points (abuse cap). Callers request limit+1 to detect truncation. */
const MAX_RUN_START_POINTS = 2_001;

export interface AgentRunStartPoint {
  runId: string;
  /** ISO-8601 timestamp; plotted at (date, time-of-day) on the Activity punchcard. */
  startedAt: string;
  status: string;
}

export interface AgentRunStartPointRange {
  /** Inclusive lower bound on started_at. */
  from: Date;
  /** Max rows to return; clamped to MAX_RUN_START_POINTS regardless of caller. */
  limit: number;
  /** Exclusive upper bound on started_at. */
  to: Date;
}

/**
 * Per-run start timestamps for a user over a time range, ascending by started_at
 * (the 07b Activity punchcard data, §2.4). Served by v2_agent_runs_user_started_idx.
 * The result is always bounded by MAX_RUN_START_POINTS.
 */
export async function listAgentRunStartPoints(
  db: Database,
  userId: UserId,
  range: AgentRunStartPointRange,
): Promise<AgentRunStartPoint[]> {
  const effectiveLimit = Math.min(Math.max(1, Math.floor(range.limit)), MAX_RUN_START_POINTS);
  const rows = await db
    .select({
      runId: agentRuns.id,
      startedAt: agentRuns.startedAt,
      status: agentRuns.status,
    })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.userId, userId),
        gte(agentRuns.startedAt, range.from),
        lt(agentRuns.startedAt, range.to),
      ),
    )
    .orderBy(asc(agentRuns.startedAt))
    .limit(effectiveLimit);
  return rows.map((row) => ({
    runId: row.runId,
    startedAt: row.startedAt.toISOString(),
    status: row.status,
  }));
}
