import type {
  AutomationId,
  AutomationRunSummary,
  AutomationSummary,
  UserId,
} from "@cheatcode/types";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  type AutomationDelivery,
  type AutomationDeliveryChannel,
  automationRunRequests,
  automationRuns,
  automations,
  messages,
} from "./schema";

type AutomationRow = typeof automations.$inferSelect;
type AutomationRunRow = typeof automationRuns.$inferSelect;
type AutomationRunRequestRow = typeof automationRunRequests.$inferSelect;

export interface CreateAutomationInput {
  userId: UserId;
  projectId: string | null;
  name: string;
  kind: "scheduled" | "event";
  prompt: string;
  model?: string | null;
  schedule?: string | null;
  triggerToolkit?: string | null;
  triggerSlug?: string | null;
  triggerId?: string | null;
  deliveryChannels: AutomationDeliveryChannel[];
  nextRunAt?: Date | null;
}

export interface UpdateAutomationInput {
  name?: string;
  status?: "running" | "paused";
  prompt?: string;
  model?: string | null;
  schedule?: string;
  deliveryChannels?: AutomationDeliveryChannel[];
  nextRunAt?: Date | null;
  triggerId?: string | null;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function automationToSummary(row: AutomationRow): AutomationSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status === "paused" ? "paused" : "running",
    kind: row.kind === "event" ? "event" : "scheduled",
    prompt: row.prompt,
    model: row.model,
    projectId: row.projectId,
    schedule: row.schedule,
    triggerToolkit: row.triggerToolkit,
    triggerSlug: row.triggerSlug,
    deliveryChannels: row.deliveryChannels,
    nextRunAt: toIso(row.nextRunAt),
    lastRunAt: toIso(row.lastRunAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function automationRunToSummary(row: AutomationRunRow): AutomationRunSummary {
  const status =
    row.status === "succeeded" || row.status === "failed" || row.status === "skipped"
      ? row.status
      : "running";
  return {
    id: row.id,
    automationId: row.automationId,
    threadId: row.threadId,
    status,
    summary: row.summary,
    error: row.error,
    deliveries: row.deliveries.map((delivery) => ({
      type: delivery.type,
      target: delivery.target,
      status: delivery.status,
      ...(delivery.error === undefined ? {} : { error: delivery.error }),
    })),
    startedAt: row.startedAt.toISOString(),
    finishedAt: toIso(row.finishedAt),
  };
}

// --- User-scoped CRUD (called inside withUserContext from the gateway) ---

export async function listAutomations(db: Database, userId: UserId): Promise<AutomationRow[]> {
  return db
    .select()
    .from(automations)
    .where(and(eq(automations.userId, userId), isNull(automations.deletedAt)))
    .orderBy(desc(automations.updatedAt));
}

export async function getAutomation(
  db: Database,
  userId: UserId,
  id: AutomationId,
): Promise<AutomationRow | null> {
  const [row] = await db
    .select()
    .from(automations)
    .where(
      and(eq(automations.id, id), eq(automations.userId, userId), isNull(automations.deletedAt)),
    )
    .limit(1);
  return row ?? null;
}

export async function createAutomation(
  db: Database,
  input: CreateAutomationInput,
): Promise<AutomationRow> {
  const [row] = await db
    .insert(automations)
    .values({
      userId: input.userId,
      projectId: input.projectId,
      name: input.name,
      kind: input.kind,
      prompt: input.prompt,
      model: input.model ?? null,
      schedule: input.schedule ?? null,
      triggerToolkit: input.triggerToolkit ?? null,
      triggerSlug: input.triggerSlug ?? null,
      triggerId: input.triggerId ?? null,
      deliveryChannels: input.deliveryChannels,
      nextRunAt: input.nextRunAt ?? null,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to insert automation");
  }
  return row;
}

export async function updateAutomation(
  db: Database,
  userId: UserId,
  id: AutomationId,
  patch: UpdateAutomationInput,
): Promise<AutomationRow | null> {
  const updates: Partial<typeof automations.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.prompt !== undefined) updates.prompt = patch.prompt;
  if (patch.model !== undefined) updates.model = patch.model;
  if (patch.schedule !== undefined) updates.schedule = patch.schedule;
  if (patch.deliveryChannels !== undefined) updates.deliveryChannels = patch.deliveryChannels;
  if (patch.nextRunAt !== undefined) updates.nextRunAt = patch.nextRunAt;
  if (patch.triggerId !== undefined) updates.triggerId = patch.triggerId;
  const [row] = await db
    .update(automations)
    .set(updates)
    .where(
      and(eq(automations.id, id), eq(automations.userId, userId), isNull(automations.deletedAt)),
    )
    .returning();
  return row ?? null;
}

export async function softDeleteAutomation(
  db: Database,
  userId: UserId,
  id: AutomationId,
): Promise<AutomationRow | null> {
  const [row] = await db
    .update(automations)
    .set({ deletedAt: new Date(), status: "paused", updatedAt: new Date() })
    .where(and(eq(automations.id, id), eq(automations.userId, userId)))
    .returning();
  return row ?? null;
}

export async function listAutomationRuns(
  db: Database,
  userId: UserId,
  automationId: AutomationId,
  limit = 50,
): Promise<AutomationRunRow[]> {
  return db
    .select()
    .from(automationRuns)
    .where(and(eq(automationRuns.automationId, automationId), eq(automationRuns.userId, userId)))
    .orderBy(desc(automationRuns.startedAt))
    .limit(limit);
}

// --- Worker-side (cron + Composio webhook + executor; not user-scoped) ---

export async function dueScheduledAutomations(db: Database, now: Date): Promise<AutomationRow[]> {
  return db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.status, "running"),
        eq(automations.kind, "scheduled"),
        isNull(automations.deletedAt),
        lte(automations.nextRunAt, now),
      ),
    )
    .orderBy(asc(automations.nextRunAt))
    .limit(200);
}

export async function findEventAutomationsByTrigger(
  db: Database,
  triggerId: string,
): Promise<AutomationRow[]> {
  return db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.triggerId, triggerId),
        eq(automations.status, "running"),
        isNull(automations.deletedAt),
      ),
    );
}

/** Insert an outbox row, collapsing duplicates by the UNIQUE dedupeKey. Returns the
 * inserted row id, or null when a row with that dedupeKey already exists. */
export async function enqueueRunRequest(
  db: Database,
  input: {
    automationId: string;
    userId: string;
    source: "scheduled" | "event" | "manual";
    dedupeKey: string;
    scheduledFor?: Date | null;
    normalized?: Record<string, string> | null;
  },
): Promise<string | null> {
  const rows = await db
    .insert(automationRunRequests)
    .values({
      automationId: input.automationId,
      userId: input.userId,
      source: input.source,
      dedupeKey: input.dedupeKey,
      scheduledFor: input.scheduledFor ?? null,
      normalized: input.normalized ?? null,
    })
    .onConflictDoNothing({ target: automationRunRequests.dedupeKey })
    .returning({ id: automationRunRequests.id });
  return rows[0]?.id ?? null;
}

export async function advanceNextRunAt(
  db: Database,
  automationId: string,
  nextRunAt: Date | null,
): Promise<void> {
  await db
    .update(automations)
    .set({ nextRunAt, lastRunAt: new Date(), updatedAt: new Date() })
    .where(eq(automations.id, automationId));
}

/** Atomically claim the oldest pending request (FOR UPDATE SKIP LOCKED) so concurrent
 * claimers never grab the same row. */
export async function claimNextRunRequest(db: Database): Promise<AutomationRunRequestRow | null> {
  const result = await db.execute(sql`
    update ${automationRunRequests}
    set status = 'claimed', claimed_at = now(), attempts = attempts + 1, updated_at = now()
    where id = (
      select id from ${automationRunRequests}
      where status = 'pending'
      order by created_at
      for update skip locked
      limit 1
    )
    returning *
  `);
  const rows = (result as unknown as { rows: AutomationRunRequestRow[] }).rows;
  return rows[0] ?? null;
}

export async function markRunRequest(
  db: Database,
  requestId: string,
  status: "running" | "done" | "failed" | "dead" | "pending",
): Promise<void> {
  await db
    .update(automationRunRequests)
    .set({ status, updatedAt: new Date() })
    .where(eq(automationRunRequests.id, requestId));
}

/** Recover claimed rows whose lease expired: back to pending (retry) or dead (exhausted). */
export async function reclaimStaleRunRequests(
  db: Database,
  leaseCutoff: Date,
  maxAttempts: number,
): Promise<void> {
  await db.execute(sql`
    update ${automationRunRequests}
    set status = case when attempts >= ${maxAttempts} then 'dead' else 'pending' end,
        updated_at = now()
    where status = 'claimed' and claimed_at < ${leaseCutoff}
  `);
}

/** Running automation runs older than `cutoff` — the reconcile sweep finalizes these. */
export async function listRunningAutomationRuns(
  db: Database,
  cutoff: Date,
  limit = 100,
): Promise<Array<{ id: string; automationId: string; threadId: string | null; userId: string }>> {
  return db
    .select({
      id: automationRuns.id,
      automationId: automationRuns.automationId,
      threadId: automationRuns.threadId,
      userId: automationRuns.userId,
    })
    .from(automationRuns)
    .where(and(eq(automationRuns.status, "running"), lte(automationRuns.startedAt, cutoff)))
    .limit(limit);
}

/** Concatenated text of the latest assistant message on a thread — the run's summary
 * for delivery. Returns null when there is no assistant text yet. */
export async function getLatestAssistantText(
  db: Database,
  threadId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ parts: messages.parts })
    .from(messages)
    .where(and(eq(messages.threadId, threadId), eq(messages.role, "assistant")))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (!row) {
    return null;
  }
  const text = row.parts
    .filter((part): part is { type: "text"; text: string } => {
      return (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      );
    })
    .map((part) => part.text)
    .join("")
    .trim();
  return text.length > 0 ? text : null;
}

export async function hasActiveAutomationRun(db: Database, automationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(and(eq(automationRuns.automationId, automationId), eq(automationRuns.status, "running")))
    .limit(1);
  return Boolean(row);
}

export async function createAutomationRun(
  db: Database,
  input: {
    automationId: string;
    requestId: string | null;
    userId: string;
    threadId?: string | null;
  },
): Promise<AutomationRunRow> {
  const [row] = await db
    .insert(automationRuns)
    .values({
      automationId: input.automationId,
      requestId: input.requestId,
      userId: input.userId,
      threadId: input.threadId ?? null,
      status: "running",
    })
    .returning();
  if (!row) {
    throw new Error("Failed to insert automation run");
  }
  return row;
}

export async function finishAutomationRun(
  db: Database,
  runId: string,
  patch: {
    status: "succeeded" | "failed" | "skipped";
    summary?: string | null;
    error?: string | null;
    threadId?: string | null;
    deliveries?: AutomationDelivery[];
  },
): Promise<void> {
  const updates: Partial<typeof automationRuns.$inferInsert> = {
    status: patch.status,
    finishedAt: new Date(),
  };
  if (patch.summary !== undefined) updates.summary = patch.summary;
  if (patch.error !== undefined) updates.error = patch.error;
  if (patch.threadId !== undefined) updates.threadId = patch.threadId;
  if (patch.deliveries !== undefined) updates.deliveries = patch.deliveries;
  await db.update(automationRuns).set(updates).where(eq(automationRuns.id, runId));
}
