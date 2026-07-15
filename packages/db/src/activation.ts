import { and, eq, exists, gte, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "./client";
import { agentRuns, users } from "./schema";

export interface ActivationEventRecord {
  cohortMonth?: string;
  cohortWeek?: string;
  eventName: "first_week_mau" | "retention_d28" | "retention_d7";
  userId: string;
}

export async function listDailyActivationEvents(
  db: Database,
  input: { day: string },
): Promise<ActivationEventRecord[]> {
  const day = normalizeDay(input.day);
  const [retentionD7, retentionD28, firstWeekMau] = await Promise.all([
    listRetentionEvents(db, day, 7),
    listRetentionEvents(db, day, 28),
    listFirstWeekMauEvents(db, day),
  ]);
  return [...retentionD7, ...retentionD28, ...firstWeekMau];
}

function normalizeDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Activation event day must be YYYY-MM-DD.");
  }
  return value;
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
