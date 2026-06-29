import {
  advanceNextRunAt,
  claimNextRunRequest,
  createAutomationRun,
  createDb,
  createThread,
  type Database,
  dueScheduledAutomations,
  enqueueRunRequest,
  findActiveAgentRunForThread,
  finishAutomationRun,
  getAutomation,
  hasActiveAutomationRun,
  listRunningAutomationRuns,
  markRunRequest,
  reclaimStaleRunRequests,
} from "@cheatcode/db";
import { createLogger } from "@cheatcode/observability";
import { AutomationId, ProjectId, ThreadId, UserId } from "@cheatcode/types";
import { Cron } from "croner";
import type { WebhooksEnv } from "./index";

const MAX_DRAIN_PER_TICK = 10;
const LEASE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
/** Grace before reconcile considers a run finished, so we never race a just-started run. */
const RECONCILE_GRACE_MS = 90 * 1000;

function nextCronRun(schedule: string, from: Date): Date | null {
  try {
    return new Cron(schedule, { timezone: "UTC" }).nextRun(from);
  } catch {
    return null;
  }
}

/** One automation tick: enqueue due scheduled runs, drain the outbox, reconcile finished runs. */
export async function runAutomationTick(env: WebhooksEnv, scheduledTime: number): Promise<void> {
  const now = new Date(scheduledTime);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    await enqueueDueScheduledRuns(db, now);
    await drainOutbox(db, env, now);
    await reconcileRunningRuns(db, now);
  } catch (error) {
    createLogger().error("automation_tick_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  } finally {
    await close();
  }
}

async function enqueueDueScheduledRuns(db: Database, now: Date): Promise<void> {
  const due = await dueScheduledAutomations(db, now);
  for (const automation of due) {
    const scheduledFor = automation.nextRunAt ?? now;
    // Idempotent: a pre-existing dedupe row counts as durable acceptance, so we still
    // advance nextRunAt and never re-enqueue the same scheduledFor forever.
    await enqueueRunRequest(db, {
      automationId: automation.id,
      userId: automation.userId,
      source: "scheduled",
      dedupeKey: `scheduled:${automation.id}:${scheduledFor.toISOString()}`,
      scheduledFor,
    });
    const next = automation.schedule ? nextCronRun(automation.schedule, now) : null;
    await advanceNextRunAt(db, automation.id, next);
  }
}

async function drainOutbox(db: Database, env: WebhooksEnv, now: Date): Promise<void> {
  await reclaimStaleRunRequests(db, new Date(now.getTime() - LEASE_TIMEOUT_MS), MAX_ATTEMPTS);
  for (let i = 0; i < MAX_DRAIN_PER_TICK; i += 1) {
    const request = await claimNextRunRequest(db);
    if (!request) {
      return;
    }
    try {
      await processRequest(db, env, request);
    } catch (error) {
      createLogger().error("automation_request_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      await markRunRequest(db, request.id, "failed");
    }
  }
}

async function processRequest(
  db: Database,
  env: WebhooksEnv,
  request: { id: string; automationId: string; userId: string },
): Promise<void> {
  const userId = UserId(request.userId);
  const automation = await getAutomation(db, userId, AutomationId(request.automationId));
  if (!automation?.projectId) {
    await markRunRequest(db, request.id, "done");
    return;
  }
  // Per-automation concurrency lock: skip (coalesce) if a run is already active.
  if (await hasActiveAutomationRun(db, automation.id)) {
    await markRunRequest(db, request.id, "done");
    return;
  }

  const thread = await createThread(db, {
    projectId: ProjectId(automation.projectId),
    title: automation.name,
    userId,
  });
  // The partial unique index on (automationId where status='running') is the real lock;
  // if a racing tick already created one, this throws and the request is marked failed.
  const run = await createAutomationRun(db, {
    automationId: automation.id,
    requestId: request.id,
    userId: request.userId,
    threadId: thread.id,
  });

  const started = await startAgentRun(
    env,
    request.userId,
    thread.id,
    automation.prompt,
    automation.model,
  );
  if (!started) {
    await finishAutomationRun(db, run.id, {
      status: "failed",
      error: "Failed to start the agent run",
    });
    await markRunRequest(db, request.id, "failed");
    return;
  }
  await markRunRequest(db, request.id, "done");
}

/** Start a run through the agent-worker service binding, exactly as the gateway does
 * (it only trusts the X-Cheatcode-User-Id header over the internal binding). The agent
 * worker applies all entitlement/sandbox/active-run guards via createAgentRunForThread. */
async function startAgentRun(
  env: WebhooksEnv,
  userId: string,
  threadId: string,
  prompt: string,
  model: string | null,
): Promise<boolean> {
  if (!env.AGENT) {
    return false;
  }
  const body = {
    message: { role: "user", parts: [{ type: "text", text: prompt }] },
    ...(model ? { model } : {}),
  };
  const response = await env.AGENT.fetch(
    new Request(`https://agent-worker.internal/v1/threads/${threadId}/runs`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", "X-Cheatcode-User-Id": userId },
      method: "POST",
    }),
  );
  return response.ok;
}

/** Finalize runs whose underlying agent run is no longer active. Optimistic success;
 * richer per-status capture + Slack/Notion/email delivery layer on top of this. */
async function reconcileRunningRuns(db: Database, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - RECONCILE_GRACE_MS);
  const running = await listRunningAutomationRuns(db, cutoff);
  for (const run of running) {
    if (!run.threadId) {
      continue;
    }
    const active = await findActiveAgentRunForThread(db, {
      threadId: ThreadId(run.threadId),
      userId: UserId(run.userId),
    });
    if (active) {
      continue;
    }
    await finishAutomationRun(db, run.id, { status: "succeeded", summary: "Run completed." });
  }
}
