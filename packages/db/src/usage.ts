import type { UserId } from "@cheatcode/types";
import { and, desc, eq, exists, gte, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "./client";
import { agentRuns, usageDailyTotals, usageEvents, users } from "./schema";

export interface UsageRollupInput {
  day: string;
}

export interface UsageDailyTotalRecord {
  agentRunCount: number;
  day: string;
  totalCachedTokens: number;
  totalCostUsd: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  userId: string;
}

export interface UserDailyCostInput {
  day: string;
  userId: UserId;
}

export interface ActivationEventRecord {
  cohortMonth?: string;
  cohortWeek?: string;
  eventName: "first_week_mau" | "retention_d28" | "retention_d7";
  userId: string;
}

export async function listUsageDailyTotals(
  db: Database,
  input: { days: number; userId: UserId },
): Promise<UsageDailyTotalRecord[]> {
  const startDay = utcDayOffset(new Date(), -(input.days - 1));
  return db
    .select({
      agentRunCount: usageDailyTotals.agentRunCount,
      day: usageDailyTotals.day,
      totalCachedTokens: usageDailyTotals.totalCachedTokens,
      totalCostUsd: usageDailyTotals.totalCostUsd,
      totalInputTokens: usageDailyTotals.totalInputTokens,
      totalOutputTokens: usageDailyTotals.totalOutputTokens,
      userId: usageDailyTotals.userId,
    })
    .from(usageDailyTotals)
    .where(and(eq(usageDailyTotals.userId, input.userId), gte(usageDailyTotals.day, startDay)))
    .orderBy(desc(usageDailyTotals.day))
    .limit(input.days);
}

export async function getUserDailyUsageCostUsd(
  db: Database,
  input: UserDailyCostInput,
): Promise<number> {
  const day = normalizeRollupDay(input.day);
  const rows = await db
    .select({
      totalCostUsd: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)::text`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, input.userId),
        gte(usageEvents.createdAt, sql`${day}::date`),
        lt(usageEvents.createdAt, sql`(${day}::date + interval '1 day')`),
      ),
    )
    .limit(1);
  return normalizedCost(rows[0]?.totalCostUsd);
}

export async function rollupUsageDailyTotals(
  db: Database,
  input: UsageRollupInput,
): Promise<UsageDailyTotalRecord[]> {
  const day = normalizeRollupDay(input.day);
  await db.execute(sql`
    insert into ${usageDailyTotals}
      (
        user_id,
        day,
        total_input_tokens,
        total_output_tokens,
        total_cached_tokens,
        total_cost_usd,
        agent_run_count
      )
    select
      user_id,
      ${day}::date,
      coalesce(sum(input_tokens), 0)::bigint,
      coalesce(sum(output_tokens), 0)::bigint,
      coalesce(sum(cached_tokens), 0)::bigint,
      coalesce(sum(cost_usd), 0)::numeric(12, 4),
      count(distinct agent_run_id)::int
    from ${usageEvents}
    where created_at >= ${day}::date
      and created_at < (${day}::date + interval '1 day')
    group by user_id
    on conflict (user_id, day) do update set
      total_input_tokens = excluded.total_input_tokens,
      total_output_tokens = excluded.total_output_tokens,
      total_cached_tokens = excluded.total_cached_tokens,
      total_cost_usd = excluded.total_cost_usd,
      agent_run_count = excluded.agent_run_count
  `);
  return db
    .select({
      agentRunCount: usageDailyTotals.agentRunCount,
      day: usageDailyTotals.day,
      totalCachedTokens: usageDailyTotals.totalCachedTokens,
      totalCostUsd: usageDailyTotals.totalCostUsd,
      totalInputTokens: usageDailyTotals.totalInputTokens,
      totalOutputTokens: usageDailyTotals.totalOutputTokens,
      userId: usageDailyTotals.userId,
    })
    .from(usageDailyTotals)
    .where(eq(usageDailyTotals.day, day));
}

export async function listDailyActivationEvents(
  db: Database,
  input: UsageRollupInput,
): Promise<ActivationEventRecord[]> {
  const day = normalizeRollupDay(input.day);
  const [retentionD7, retentionD28, firstWeekMau] = await Promise.all([
    listRetentionEvents(db, day, 7),
    listRetentionEvents(db, day, 28),
    listFirstWeekMauEvents(db, day),
  ]);
  return [...retentionD7, ...retentionD28, ...firstWeekMau];
}

function normalizeRollupDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Usage rollup day must be YYYY-MM-DD.");
  }
  return value;
}

function normalizedCost(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function utcDayOffset(now: Date, dayOffset: number): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + dayOffset);
  return day.toISOString().slice(0, 10);
}

async function listRetentionEvents(
  db: Database,
  day: string,
  ageDays: 7 | 28,
): Promise<ActivationEventRecord[]> {
  const rows = await db
    .select({
      cohortMonth: sql<string>`to_char(date_trunc('month', ${users.createdAt}), 'YYYY-MM-DD')`,
      cohortWeek: sql<string>`to_char(date_trunc('week', ${users.createdAt}), 'YYYY-MM-DD')`,
      userId: users.id,
    })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        eq(sql`${users.createdAt}::date`, sql`${day}::date - (${ageDays}::int * interval '1 day')`),
        exists(
          db
            .select({ one: sql`1` })
            .from(agentRuns)
            .where(
              and(
                eq(agentRuns.userId, users.id),
                gte(agentRuns.startedAt, sql`${day}::date`),
                lt(agentRuns.startedAt, sql`(${day}::date + interval '1 day')`),
              ),
            )
            .limit(1),
        ),
      ),
    );
  const eventName = ageDays === 7 ? "retention_d7" : "retention_d28";
  return rows.map((row) => ({
    cohortMonth: row.cohortMonth,
    cohortWeek: row.cohortWeek,
    eventName,
    userId: row.userId,
  }));
}

async function listFirstWeekMauEvents(db: Database, day: string): Promise<ActivationEventRecord[]> {
  const rows = await db
    .select({
      cohortWeek: sql<string>`to_char(date_trunc('week', ${users.createdAt}), 'YYYY-MM-DD')`,
      userId: users.id,
    })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        eq(sql`${users.createdAt}::date`, sql`${day}::date - interval '7 days'`),
        sql`(
          select count(*)::int
          from ${agentRuns}
          where ${agentRuns.userId} = ${users.id}
            and ${agentRuns.startedAt} >= ${users.createdAt}
            and ${agentRuns.startedAt} < (${users.createdAt} + interval '7 days')
        ) >= 3`,
      ),
    );
  return rows.map((row) => ({
    cohortWeek: row.cohortWeek,
    eventName: "first_week_mau",
    userId: row.userId,
  }));
}
