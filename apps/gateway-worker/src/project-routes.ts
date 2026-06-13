import { hmacSha256Base64 } from "@cheatcode/auth";
import {
  createDb,
  createProject,
  createThread,
  getProject,
  getProjectWriteState,
  getThread,
  listProjects,
  listProjectThreads,
  listThreadMessages,
  type MessageRecord,
  type ProjectSummaryRecord,
  softDeleteProject,
  type ThreadRecord,
  updateProject,
  withUserContext,
} from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import {
  CreateProjectSchema,
  CreateThreadSchema,
  Paginated,
  PaginationQuerySchema,
  ProjectId,
  type ProjectId as ProjectIdType,
  ProjectSummarySchema,
  ThreadId,
  type ThreadId as ThreadIdType,
  ThreadSchema,
  UIMessageRecordSchema,
  UpdateProjectSchema,
  type UserId,
} from "@cheatcode/types";
import { z } from "zod";
import { enforceActiveProjectLimit, type LimitBindings } from "./limits";

export interface ProjectRouteEnv extends LimitBindings {
  AGENT: Fetcher;
  HYPERDRIVE: Hyperdrive;
  INTERNAL_MAINTENANCE_SECRET?: WorkerSecret;
}

const IdParamSchema = z.string().uuid();

export async function listProjectsRoute(
  env: ProjectRouteEnv,
  ctx: ExecutionContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const pagination = parsePagination(request);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const projects = await withUserContext(db, userId, (tx) => listProjects(tx, userId));
    const page = paginate(projects.map(projectResponse), pagination);
    return Response.json(Paginated(ProjectSummarySchema).parse(page));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function createProjectRoute(
  env: ProjectRouteEnv,
  ctx: ExecutionContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const parsedInput = CreateProjectSchema.safeParse(await request.json());
  if (!parsedInput.success) {
    throw invalidRequestBody("Invalid project payload", parsedInput.error);
  }
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const project = await withUserContext(db, userId, async (tx) => {
      await enforceActiveProjectLimit(env, tx, userId);
      return createProject(tx, {
        ...(parsedInput.data.budgetCapUsd === undefined
          ? {}
          : { budgetCapUsd: parsedInput.data.budgetCapUsd }),
        mode: parsedInput.data.mode,
        name: parsedInput.data.name,
        ...(parsedInput.data.defaultModel === undefined
          ? {}
          : { defaultModel: parsedInput.data.defaultModel }),
        ...(parsedInput.data.masterInstructions
          ? { masterInstructions: parsedInput.data.masterInstructions }
          : {}),
        userId,
      });
    });
    return Response.json(ProjectSummarySchema.parse(projectResponse(project)), { status: 201 });
  } finally {
    ctx.waitUntil(close());
  }
}

export async function getProjectRoute(
  env: ProjectRouteEnv,
  ctx: ExecutionContext,
  projectId: ProjectIdType,
  userId: UserId,
): Promise<Response> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const project = await withUserContext(db, userId, (tx) =>
      getProject(tx, { projectId, userId }),
    );
    if (!project) {
      throw notFound("Project not found");
    }
    return Response.json(ProjectSummarySchema.parse(projectResponse(project)));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function updateProjectRoute(
  env: ProjectRouteEnv,
  ctx: ExecutionContext,
  request: Request,
  projectId: ProjectIdType,
  userId: UserId,
): Promise<Response> {
  const parsedInput = UpdateProjectSchema.safeParse(await request.json());
  if (!parsedInput.success) {
    throw invalidRequestBody("Invalid project update payload", parsedInput.error);
  }
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const input = parsedInput.data;
    const project = await withUserContext(db, userId, (tx) =>
      updateWritableProject(tx, projectId, userId, {
        ...(input.budgetCapUsd === undefined ? {} : { budgetCapUsd: input.budgetCapUsd }),
        ...(input.defaultModel === undefined ? {} : { defaultModel: input.defaultModel }),
        ...(input.masterInstructions === undefined
          ? {}
          : { masterInstructions: input.masterInstructions }),
        ...(input.name === undefined ? {} : { name: input.name }),
      }),
    );
    if (!project) {
      throw notFound("Project not found");
    }
    return Response.json(ProjectSummarySchema.parse(projectResponse(project)));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function deleteProjectRoute(
  env: ProjectRouteEnv,
  ctx: ExecutionContext,
  projectId: ProjectIdType,
  userId: UserId,
): Promise<Response> {
  const cleanupBody = JSON.stringify({ projectIds: [projectId], runIds: [] });
  const cleanupHeaders = await internalMaintenanceHeaders(env, cleanupBody);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const deleted = await withUserContext(db, userId, (tx) =>
      softDeleteProject(tx, { projectId, userId }),
    );
    if (!deleted) {
      throw notFound("Project not found");
    }
    ctx.waitUntil(deleteProjectAgentState(env, userId, cleanupBody, cleanupHeaders));
    return new Response(null, { status: 204 });
  } finally {
    ctx.waitUntil(close());
  }
}

export async function listProjectThreadsRoute(
  env: ProjectRouteEnv,
  ctx: ExecutionContext,
  request: Request,
  projectId: ProjectIdType,
  userId: UserId,
): Promise<Response> {
  const pagination = parsePagination(request);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const threadRows = await withUserContext(db, userId, async (tx) => {
      await requireProject(tx, projectId, userId);
      return listProjectThreads(tx, { projectId, userId });
    });
    const page = paginate(threadRows.map(threadResponse), pagination);
    return Response.json(Paginated(ThreadSchema).parse(page));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function createThreadRoute(
  env: ProjectRouteEnv,
  ctx: ExecutionContext,
  request: Request,
  projectId: ProjectIdType,
  userId: UserId,
): Promise<Response> {
  const parsedInput = CreateThreadSchema.safeParse(await request.json());
  if (!parsedInput.success) {
    throw invalidRequestBody("Invalid thread payload", parsedInput.error);
  }
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const thread = await withUserContext(db, userId, async (tx) => {
      await requireWritableProject(tx, projectId, userId);
      return createThread(tx, {
        projectId,
        userId,
        ...(parsedInput.data.title === undefined ? {} : { title: parsedInput.data.title }),
      });
    });
    return Response.json(ThreadSchema.parse(threadResponse(thread)), { status: 201 });
  } finally {
    ctx.waitUntil(close());
  }
}

export async function getThreadRoute(
  env: ProjectRouteEnv,
  ctx: ExecutionContext,
  threadId: ThreadIdType,
  userId: UserId,
): Promise<Response> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const thread = await withUserContext(db, userId, (tx) => getThread(tx, { threadId, userId }));
    if (!thread) {
      throw notFound("Thread not found");
    }
    return Response.json(ThreadSchema.parse(threadResponse(thread)));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function listThreadMessagesRoute(
  env: ProjectRouteEnv,
  ctx: ExecutionContext,
  request: Request,
  threadId: ThreadIdType,
  userId: UserId,
): Promise<Response> {
  const pagination = parsePagination(request);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const rows = await withUserContext(db, userId, async (tx) => {
      await requireThread(tx, threadId, userId);
      return listThreadMessages(tx, { threadId, userId });
    });
    const page = paginate(rows.map(messageResponse), pagination);
    return Response.json(Paginated(UIMessageRecordSchema).parse(page));
  } finally {
    ctx.waitUntil(close());
  }
}

export function parseProjectParam(value: string): ProjectIdType {
  const parsed = IdParamSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidPathParam("Invalid project id", parsed.error);
  }
  return ProjectId(parsed.data);
}

export function parseThreadParam(value: string): ThreadIdType {
  const parsed = IdParamSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidPathParam("Invalid thread id", parsed.error);
  }
  return ThreadId(parsed.data);
}

async function requireProject(
  db: Parameters<typeof getProject>[0],
  projectId: ProjectIdType,
  userId: UserId,
): Promise<void> {
  const project = await getProject(db, { projectId, userId });
  if (!project) {
    throw notFound("Project not found");
  }
}

async function requireWritableProject(
  db: Parameters<typeof getProjectWriteState>[0],
  projectId: ProjectIdType,
  userId: UserId,
): Promise<void> {
  const state = await getProjectWriteState(db, { projectId, userId });
  if (!state) {
    throw notFound("Project not found");
  }
  if (state.readOnly) {
    throw new APIError(403, "permission_plan_required", "Project is read-only after downgrade", {
      details: {
        archiveAfter: state.archiveAfter?.toISOString() ?? null,
        overQuota: state.overQuota,
      },
      hint: "Delete or archive over-limit projects, or upgrade your plan to continue editing this project.",
      retriable: false,
    });
  }
}

async function updateWritableProject(
  db: Parameters<typeof updateProject>[0],
  projectId: ProjectIdType,
  userId: UserId,
  input: Omit<Parameters<typeof updateProject>[1], "projectId" | "userId">,
): Promise<ProjectSummaryRecord | null> {
  await requireWritableProject(db, projectId, userId);
  return updateProject(db, { projectId, userId, ...input });
}

async function requireThread(
  db: Parameters<typeof getThread>[0],
  threadId: ThreadIdType,
  userId: UserId,
): Promise<void> {
  const thread = await getThread(db, { threadId, userId });
  if (!thread) {
    throw notFound("Thread not found");
  }
}

function projectResponse(project: ProjectSummaryRecord) {
  return {
    archiveAfter: project.archiveAfter?.toISOString() ?? null,
    archivedPendingAction: project.archivedPendingAction,
    budgetCapUsd: project.budgetCapUsd,
    createdAt: project.createdAt.toISOString(),
    defaultModel: project.defaultModel,
    id: project.id,
    masterInstructions: project.masterInstructions,
    mode: project.mode,
    name: project.name,
    overQuota: project.overQuota,
    readOnly: project.readOnly,
    updatedAt: project.updatedAt.toISOString(),
  };
}

function threadResponse(thread: ThreadRecord) {
  return {
    activeRunId: thread.activeRunId,
    createdAt: thread.createdAt.toISOString(),
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    updatedAt: thread.updatedAt.toISOString(),
  };
}

function messageResponse(message: MessageRecord) {
  return {
    agentRunId: message.agentRunId,
    createdAt: message.createdAt.toISOString(),
    id: message.id,
    parts: message.parts,
    role: message.role,
    threadId: message.threadId,
  };
}

function parsePagination(request: Request): { cursor?: string; limit: number } {
  const url = new URL(request.url);
  const parsed = PaginationQuerySchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    throw invalidQueryParam("Invalid pagination query", parsed.error);
  }
  return {
    limit: parsed.data.limit,
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
  };
}

function paginate<T extends { id: string }>(
  rows: T[],
  pagination: { cursor?: string; limit: number },
): { data: T[]; has_more: boolean; next_cursor: string | null } {
  const startIndex =
    pagination.cursor === undefined
      ? 0
      : Math.max(0, rows.findIndex((row) => row.id === pagination.cursor) + 1);
  const data = rows.slice(startIndex, startIndex + pagination.limit);
  const nextCursor = data.length > 0 ? (data.at(-1)?.id ?? null) : null;
  const hasMore = startIndex + pagination.limit < rows.length;
  return {
    data,
    has_more: hasMore,
    next_cursor: hasMore ? nextCursor : null,
  };
}

function invalidRequestBody(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_request_body", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}

async function deleteProjectAgentState(
  env: ProjectRouteEnv,
  userId: UserId,
  body: string,
  headers: Headers,
): Promise<void> {
  const response = await env.AGENT.fetch(
    `https://agent.internal/internal/users/${userId}/delete-state`,
    {
      body,
      headers,
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new APIError(503, "unavailable_maintenance", "Project sandbox cleanup failed", {
      details: { status: response.status },
      retriable: true,
    });
  }
}

async function internalMaintenanceHeaders(env: ProjectRouteEnv, rawBody: string): Promise<Headers> {
  const secret = await readMaintenanceSecret(env);
  const timestamp = String(Date.now());
  const signature = await hmacSha256Base64(`${timestamp}.${rawBody}`, secret);
  return new Headers({
    "content-type": "application/json",
    "x-cheatcode-maintenance-signature": signature,
    "x-cheatcode-maintenance-timestamp": timestamp,
  });
}

async function readMaintenanceSecret(env: ProjectRouteEnv): Promise<string> {
  let value: string | undefined;
  try {
    value = await resolveWorkerSecret(env.INTERNAL_MAINTENANCE_SECRET);
  } catch {
    throw new APIError(503, "unavailable_maintenance", "Maintenance secret is unavailable", {
      hint: "Verify INTERNAL_MAINTENANCE_SECRET on the gateway Worker.",
      retriable: false,
    });
  }
  if (!value) {
    throw new APIError(503, "unavailable_maintenance", "Maintenance secret is not configured", {
      hint: "Set INTERNAL_MAINTENANCE_SECRET on the gateway Worker.",
      retriable: false,
    });
  }
  return value;
}

function invalidPathParam(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_path_param", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}

function invalidQueryParam(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_query_param", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}

function notFound(message: string): APIError {
  return new APIError(404, "not_found_project", message, { retriable: false });
}
