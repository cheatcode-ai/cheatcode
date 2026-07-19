import { sql } from "drizzle-orm";
import type { Database } from "./client";

export type ActivationEventName = "first_week_mau" | "retention_d28" | "retention_d7";

export interface ActivationEventRecord {
  cohortMonth?: string;
  cohortWeek?: string;
  eventName: ActivationEventName;
  userId: string;
}

export interface ActivationEventCursor {
  eventName: ActivationEventName;
  userId: string;
}

export interface ActivationEventPage {
  items: ActivationEventRecord[];
  nextCursor: ActivationEventCursor | null;
}

interface ActivationEventRow {
  cohort_month: string | null;
  cohort_week: string | null;
  event_name: ActivationEventName;
  event_order: number;
  user_id: string;
}

const ACTIVATION_EVENT_MAX_PAGE_SIZE = 200;
/** Returns one stable, bounded page across all daily activation event kinds. */
export async function listDailyActivationEventPage(
  db: Database,
  input: { cursor?: ActivationEventCursor; day: string; limit: number },
): Promise<ActivationEventPage> {
  const day = normalizeDay(input.day);
  const limit = pageLimit(input.limit);
  const result = await db.execute(sql`
    select * from public.webhooks_list_daily_activation_events(
      ${day}::date,
      ${input.cursor?.eventName ?? null},
      ${input.cursor?.userId ?? null}::uuid,
      ${limit}
    )
  `);
  return activationEventPage(result.rows as unknown as ActivationEventRow[], limit);
}

function activationEventPage(rows: ActivationEventRow[], limit: number): ActivationEventPage {
  const pageRows = rows.slice(0, limit);
  const items = pageRows.map(toActivationEventRecord);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last ? { eventName: last.eventName, userId: last.userId } : null,
  };
}

function toActivationEventRecord(row: ActivationEventRow): ActivationEventRecord {
  return {
    ...(row.cohort_month ? { cohortMonth: row.cohort_month } : {}),
    ...(row.cohort_week ? { cohortWeek: row.cohort_week } : {}),
    eventName: row.event_name,
    userId: row.user_id,
  };
}

function pageLimit(value: number): number {
  return Math.max(1, Math.min(ACTIVATION_EVENT_MAX_PAGE_SIZE, Math.trunc(value)));
}

function normalizeDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Activation event day must be YYYY-MM-DD.");
  }
  return value;
}
