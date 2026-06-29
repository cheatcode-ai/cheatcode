import {
  automationRunToSummary,
  automationToSummary,
  createAutomation,
  createDb,
  createProject,
  enqueueRunRequest,
  getAutomation,
  listAutomationRuns,
  listAutomations,
  softDeleteAutomation,
  type UpdateAutomationInput,
  updateAutomation,
  withUserContext,
} from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import {
  AutomationId,
  type AutomationId as AutomationIdType,
  AutomationListResponseSchema,
  AutomationRunsResponseSchema,
  AutomationSummarySchema,
  CreateAutomationSchema,
  type UpdateAutomation,
  UpdateAutomationSchema,
  type UserId,
} from "@cheatcode/types";
import { Cron } from "croner";
import { z } from "zod";
import { requireVerifiedClerkEmail } from "./authenticate";
import { deleteAutomationTrigger, registerAutomationTrigger } from "./automation-triggers";
import type { GatewayEnv } from "./index";
import { enforceActiveProjectLimit } from "./limits";

const IdParamSchema = z.string().uuid();

function invalidBody(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_request_body", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}

function notFound(message: string): APIError {
  return new APIError(404, "not_found_automation", message, { retriable: false });
}

function parseAutomationId(value: string): AutomationIdType {
  const parsed = IdParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", "Invalid automation id", { retriable: false });
  }
  return AutomationId(parsed.data);
}

/** Next fire time for a cron expression (UTC), or null if it never fires. */
export function nextCronRun(schedule: string, from: Date = new Date()): Date | null {
  try {
    return new Cron(schedule, { timezone: "UTC" }).nextRun(from);
  } catch {
    throw new APIError(400, "invalid_request_body", "Invalid cron schedule", { retriable: false });
  }
}

interface ScheduleState {
  kind: string;
  status: string;
  schedule: string | null;
  nextRunAt: Date | null;
}

/** Re-arm `nextRunAt` after an update: clear it when paused, recompute when the
 * (scheduled) cron changes or the automation resumes, otherwise leave it. */
function resolveNextRunAt(existing: ScheduleState, patch: UpdateAutomation): Date | null {
  const willRun = (patch.status ?? existing.status) === "running";
  if (!willRun) {
    return null;
  }
  if (existing.kind !== "scheduled") {
    return existing.nextRunAt;
  }
  const schedule = patch.schedule ?? existing.schedule;
  return schedule ? nextCronRun(schedule) : existing.nextRunAt;
}

function buildAutomationUpdate(
  patch: UpdateAutomation,
  nextRunAt: Date | null,
): UpdateAutomationInput {
  const update: UpdateAutomationInput = { nextRunAt };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.prompt !== undefined) update.prompt = patch.prompt;
  if (patch.model !== undefined) update.model = patch.model;
  if (patch.schedule !== undefined) update.schedule = patch.schedule;
  if (patch.deliveryChannels !== undefined) update.deliveryChannels = patch.deliveryChannels;
  return update;
}

export async function listAutomationsRoute(
  env: GatewayEnv,
  ctx: ExecutionContext,
  userId: UserId,
): Promise<Response> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const rows = await withUserContext(db, userId, (tx) => listAutomations(tx, userId));
    return Response.json(
      AutomationListResponseSchema.parse({ automations: rows.map(automationToSummary) }),
    );
  } finally {
    ctx.waitUntil(close());
  }
}

export async function createAutomationRoute(
  env: GatewayEnv,
  ctx: ExecutionContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  // Email verification is enforced here (creation goes through the gateway with a
  // live bearer token); the internal run path later trusts the persisted result.
  await requireVerifiedClerkEmail(request, env);
  const parsed = CreateAutomationSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw invalidBody("Invalid automation payload", parsed.error);
  }
  const input = parsed.data;
  const nextRunAt =
    input.kind === "scheduled" && input.schedule ? nextCronRun(input.schedule) : null;

  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const summary = await withUserContext(db, userId, async (tx) => {
      // Dedicated project = the automation's persistent workspace. Same active-project
      // guard interactive creation uses, so automations can't bypass the cap.
      await enforceActiveProjectLimit(env, tx, userId);
      const project = await createProject(tx, {
        mode: "general",
        name: input.name,
        userId,
        ...(input.model === undefined ? {} : { defaultModel: input.model }),
      });
      const row = await createAutomation(tx, {
        userId,
        projectId: project.id,
        name: input.name,
        kind: input.kind,
        prompt: input.prompt,
        model: input.model ?? null,
        schedule: input.schedule ?? null,
        triggerToolkit: input.triggerToolkit ?? null,
        triggerSlug: input.triggerSlug ?? null,
        triggerId: null,
        deliveryChannels: input.deliveryChannels,
        nextRunAt,
      });
      return automationToSummary(row);
    });
    // For event automations, register the Composio trigger (fail-soft) and persist its
    // triggerId so the webhook handler can route events to this automation.
    if (input.kind === "event" && input.triggerSlug) {
      const triggerId = await registerAutomationTrigger(env, userId, input.triggerSlug);
      if (triggerId) {
        await withUserContext(db, userId, (tx) =>
          updateAutomation(tx, userId, AutomationId(summary.id), { triggerId }),
        );
      }
    }
    return Response.json(AutomationSummarySchema.parse(summary), { status: 201 });
  } finally {
    ctx.waitUntil(close());
  }
}

export async function getAutomationRoute(
  env: GatewayEnv,
  ctx: ExecutionContext,
  userId: UserId,
  automationId: string,
): Promise<Response> {
  const id = parseAutomationId(automationId);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const row = await withUserContext(db, userId, (tx) => getAutomation(tx, userId, id));
    if (!row) {
      throw notFound("Automation not found");
    }
    return Response.json(AutomationSummarySchema.parse(automationToSummary(row)));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function updateAutomationRoute(
  env: GatewayEnv,
  ctx: ExecutionContext,
  request: Request,
  userId: UserId,
  automationId: string,
): Promise<Response> {
  const id = parseAutomationId(automationId);
  const parsed = UpdateAutomationSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw invalidBody("Invalid automation payload", parsed.error);
  }
  const patch = parsed.data;
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const summary = await withUserContext(db, userId, async (tx) => {
      const existing = await getAutomation(tx, userId, id);
      if (!existing) {
        throw notFound("Automation not found");
      }
      const nextRunAt = resolveNextRunAt(existing, patch);
      const row = await updateAutomation(tx, userId, id, buildAutomationUpdate(patch, nextRunAt));
      if (!row) {
        throw notFound("Automation not found");
      }
      return automationToSummary(row);
    });
    return Response.json(AutomationSummarySchema.parse(summary));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function deleteAutomationRoute(
  env: GatewayEnv,
  ctx: ExecutionContext,
  userId: UserId,
  automationId: string,
): Promise<Response> {
  const id = parseAutomationId(automationId);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const row = await withUserContext(db, userId, (tx) => softDeleteAutomation(tx, userId, id));
    if (!row) {
      throw notFound("Automation not found");
    }
    if (row.triggerId) {
      await deleteAutomationTrigger(env, row.triggerId);
    }
    return new Response(null, { status: 204 });
  } finally {
    ctx.waitUntil(close());
  }
}

/** Enqueue a one-off run now (writes a manual outbox row the claimer picks up). */
export async function runAutomationNowRoute(
  env: GatewayEnv,
  ctx: ExecutionContext,
  userId: UserId,
  automationId: string,
): Promise<Response> {
  const id = parseAutomationId(automationId);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const result = await withUserContext(db, userId, async (tx) => {
      const automation = await getAutomation(tx, userId, id);
      if (!automation) {
        throw notFound("Automation not found");
      }
      const requestId = await enqueueRunRequest(tx, {
        automationId: id,
        userId,
        source: "manual",
        dedupeKey: `manual:${id}:${crypto.randomUUID()}`,
      });
      // A manual run never collides with the cron schedule, so don't disturb nextRunAt.
      return { requestId };
    });
    return Response.json({ enqueued: true, requestId: result.requestId }, { status: 202 });
  } finally {
    ctx.waitUntil(close());
  }
}

export async function listAutomationRunsRoute(
  env: GatewayEnv,
  ctx: ExecutionContext,
  userId: UserId,
  automationId: string,
): Promise<Response> {
  const id = parseAutomationId(automationId);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const rows = await withUserContext(db, userId, (tx) => listAutomationRuns(tx, userId, id));
    return Response.json(
      AutomationRunsResponseSchema.parse({ runs: rows.map(automationRunToSummary) }),
    );
  } finally {
    ctx.waitUntil(close());
  }
}
