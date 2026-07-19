import {
  beginProjectDeletion,
  beginThreadDeletion,
  createDb,
  createProject,
  createThread,
  getProject,
  getProjectWriteState,
  getThread,
  listProjects,
  listProjectThreads,
  listThreadMessages,
  lockUserProjectMutations,
  type MessageRecord,
  type ProjectSummaryRecord,
  type ThreadRecord,
  updateProject,
  updateThread,
  withUserContext,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import { APIError, readJsonRequest } from "@cheatcode/observability";
import {
  CreateProjectSchema,
  type CreateThread,
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
  UpdateThreadSchema,
  type UserId,
} from "@cheatcode/types";
import { z } from "zod";
import { enforceActiveProjectLimit, type LimitBindings } from "./limits";
import {
  enqueueResourceDeletion,
  type ResourceDeletionEnqueueEnv,
} from "./resource-deletion-enqueue";
import type { WaitUntilContext } from "./wait-until-context";

const MAX_PROJECT_REQUEST_BYTES = 64 * 1024;

export interface ProjectRouteEnv extends LimitBindings, ResourceDeletionEnqueueEnv {
  DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
}

const IdParamSchema = z.string().uuid();
const CursorIdentitySchema = z.object({
  at: z.string().datetime(),
  id: z.string().uuid(),
});
const PageCursorSchema = z.discriminatedUnion("kind", [
  CursorIdentitySchema.extend({
    kind: z.literal("messages"),
    segment: z.number().int().nonnegative(),
    v: z.literal(2),
  }).strict(),
  CursorIdentitySchema.extend({
    kind: z.literal("projects"),
    v: z.literal(1),
  }).strict(),
  CursorIdentitySchema.extend({
    kind: z.literal("threads"),
    v: z.literal(1),
  }).strict(),
]);
type PageCursorKind = "messages" | "projects" | "threads";

export async function listProjectsRoute(
  env: ProjectRouteEnv,
  ctx: WaitUntilContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const pagination = parsePagination(request, "projects");
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const projects = await withUserContext(db, userId, (tx) =>
      listProjects(tx, {
        ...(pagination.cursor ? { cursor: pagination.cursor } : {}),
        limit: pagination.limit + 1,
        userId,
      }),
    );
    const page = paginateRows(projects, pagination, "projects");
    return Response.json(
      Paginated(ProjectSummarySchema).parse({
        ...page,
        data: page.data.map(projectResponse),
      }),
    );
  } finally {
    ctx.waitUntil(close());
  }
}

export async function createProjectRoute(
  env: ProjectRouteEnv,
  ctx: WaitUntilContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const parsedInput = CreateProjectSchema.safeParse(
    await readJsonRequest(request, MAX_PROJECT_REQUEST_BYTES, "Project request"),
  );
  if (!parsedInput.success) {
    throw invalidRequestBody("Invalid project payload", parsedInput.error);
  }
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const project = await withUserContext(db, userId, async (tx) => {
      await enforceActiveProjectLimit(tx, userId);
      return createProject(tx, {
        ...(parsedInput.data.importRepoUrl
          ? { importRepoUrl: parsedInput.data.importRepoUrl }
          : {}),
        mode: parsedInput.data.mode,
        name: parsedInput.data.name,
        ...(parsedInput.data.defaultModel === undefined
          ? {}
          : { defaultModel: parsedInput.data.defaultModel }),
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
  ctx: WaitUntilContext,
  projectId: ProjectIdType,
  userId: UserId,
): Promise<Response> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const project = await withUserContext(db, userId, (tx) =>
      getProject(tx, { projectId, userId }),
    );
    if (!project) {
      throw projectNotFound();
    }
    return Response.json(ProjectSummarySchema.parse(projectResponse(project)));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function updateProjectRoute(
  env: ProjectRouteEnv,
  ctx: WaitUntilContext,
  request: Request,
  projectId: ProjectIdType,
  userId: UserId,
): Promise<Response> {
  const parsedInput = UpdateProjectSchema.safeParse(
    await readJsonRequest(request, MAX_PROJECT_REQUEST_BYTES, "Project request"),
  );
  if (!parsedInput.success) {
    throw invalidRequestBody("Invalid project update payload", parsedInput.error);
  }
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const input = parsedInput.data;
    const project = await withUserContext(db, userId, (tx) =>
      updateWritableProject(tx, projectId, userId, {
        ...(input.importRepoUrl === undefined ? {} : { importRepoUrl: input.importRepoUrl }),
        ...(input.defaultModel === undefined ? {} : { defaultModel: input.defaultModel }),
        ...(input.name === undefined ? {} : { name: input.name }),
      }),
    );
    if (!project) {
      throw projectNotFound();
    }
    return Response.json(ProjectSummarySchema.parse(projectResponse(project)));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function deleteProjectRoute(
  env: ProjectRouteEnv,
  ctx: WaitUntilContext,
  projectId: ProjectIdType,
  userId: UserId,
): Promise<Response> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const deletion = await withUserContext(db, userId, (tx) =>
      beginProjectDeletion(tx, { projectId, userId }),
    );
    if (deletion.type === "not-found") {
      throw projectNotFound();
    }
    if (deletion.type === "active-run") {
      throw new APIError(409, "conflict_run_already_active", "Project has an active agent run", {
        hint: "Cancel or wait for every project run to finish, then retry deletion.",
        retriable: true,
      });
    }
    await enqueueResourceDeletion(env, {
      deletedAt: deletion.deletedAt.toISOString(),
      kind: "project-deletion",
      projectId,
      userId,
      workspaceSlug: deletion.workspaceSlug,
    });
    return new Response(null, { status: 202 });
  } finally {
    ctx.waitUntil(close());
  }
}

export async function listProjectThreadsRoute(
  env: ProjectRouteEnv,
  ctx: WaitUntilContext,
  request: Request,
  projectId: ProjectIdType,
  userId: UserId,
): Promise<Response> {
  const pagination = parsePagination(request, "threads");
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const threadRows = await withUserContext(db, userId, async (tx) => {
      await requireProject(tx, projectId, userId);
      return listProjectThreads(tx, {
        ...(pagination.cursor ? { cursor: pagination.cursor } : {}),
        limit: pagination.limit + 1,
        projectId,
        userId,
      });
    });
    const page = paginateRows(threadRows, pagination, "threads");
    return Response.json(
      Paginated(ThreadSchema).parse({ ...page, data: page.data.map(threadResponse) }),
    );
  } finally {
    ctx.waitUntil(close());
  }
}

/**
 * `POST /v1/threads` — create a chat (chat-first). With no `projectId` the chat is
 * project-less; its `mode`/`importRepoUrl`/`defaultModel` ride the thread as launch
 * intent until a workspace-backed tool lazily materializes the project. With
 * `projectId` set it's the deliberate "add a chat to an existing project" grouping.
 */
export async function createChatRoute(
  env: ProjectRouteEnv,
  ctx: WaitUntilContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const parsedInput = CreateThreadSchema.safeParse(
    await readJsonRequest(request, MAX_PROJECT_REQUEST_BYTES, "Thread request"),
  );
  if (!parsedInput.success) {
    throw invalidRequestBody("Invalid thread payload", parsedInput.error);
  }
  const input = parsedInput.data;
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const thread = await withUserContext(db, userId, (tx) =>
      createThreadForRequest(tx, input, userId),
    );
    return Response.json(ThreadSchema.parse(threadResponse(thread)), { status: 201 });
  } finally {
    ctx.waitUntil(close());
  }
}

type CreateThreadDb = Parameters<typeof createThread>[0];
type CreateThreadInsert = Parameters<typeof createThread>[1];

async function createThreadForRequest(
  db: CreateThreadDb,
  input: CreateThread,
  userId: UserId,
): Promise<ThreadRecord> {
  if (input.projectId) {
    const projectId = ProjectId(input.projectId);
    await requireWritableProject(db, projectId, userId);
    return createThread(db, {
      projectId,
      userId,
      ...(input.title === undefined ? {} : { title: input.title }),
    });
  }

  const launchIntent = threadLaunchIntent(input);
  return createThread(db, {
    userId,
    ...(hasLaunchIntent(launchIntent) ? { launchIntent } : {}),
    ...(input.title === undefined ? {} : { title: input.title }),
  });
}

function threadLaunchIntent(input: CreateThread): NonNullable<CreateThreadInsert["launchIntent"]> {
  return {
    ...(input.defaultModel === undefined ? {} : { defaultModel: input.defaultModel }),
    ...(input.initialPrompt === undefined ? {} : { initialPrompt: input.initialPrompt }),
    ...(input.importRepoUrl === undefined ? {} : { importRepoUrl: input.importRepoUrl }),
    ...(input.mode === undefined ? {} : { mode: input.mode }),
  };
}

function hasLaunchIntent(launchIntent: NonNullable<CreateThreadInsert["launchIntent"]>): boolean {
  return Object.keys(launchIntent).length > 0;
}

export async function getThreadRoute(
  env: ProjectRouteEnv,
  ctx: WaitUntilContext,
  threadId: ThreadIdType,
  userId: UserId,
): Promise<Response> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const thread = await withUserContext(db, userId, (tx) => getThread(tx, { threadId, userId }));
    if (!thread) {
      throw threadNotFound();
    }
    return Response.json(ThreadSchema.parse(threadResponse(thread)));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function updateThreadRoute(
  env: ProjectRouteEnv,
  ctx: WaitUntilContext,
  request: Request,
  threadId: ThreadIdType,
  userId: UserId,
): Promise<Response> {
  const parsedInput = UpdateThreadSchema.safeParse(
    await readJsonRequest(request, MAX_PROJECT_REQUEST_BYTES, "Thread request"),
  );
  if (!parsedInput.success) {
    throw invalidRequestBody("Invalid thread update payload", parsedInput.error);
  }
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const thread = await withUserContext(db, userId, (tx) =>
      updateThread(tx, { threadId, title: parsedInput.data.title, userId }),
    );
    if (!thread) {
      throw threadNotFound();
    }
    return Response.json(ThreadSchema.parse(threadResponse(thread)));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function deleteThreadRoute(
  env: ProjectRouteEnv,
  ctx: WaitUntilContext,
  threadId: ThreadIdType,
  userId: UserId,
): Promise<Response> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const deleted = await withUserContext(db, userId, (tx) =>
      beginThreadDeletion(tx, { threadId, userId }),
    );
    if (deleted.type === "not-found") {
      throw threadNotFound();
    }
    if (deleted.type === "active-run") {
      throw new APIError(409, "conflict_run_already_active", "Thread has an active agent run", {
        hint: "Cancel or wait for the run to finish, then retry deletion.",
        retriable: true,
      });
    }
    await enqueueResourceDeletion(env, {
      deletedAt: deleted.deletedAt.toISOString(),
      kind: "thread-deletion",
      projectId: deleted.projectId,
      threadId,
      userId,
    });
    return new Response(null, { status: 202 });
  } finally {
    ctx.waitUntil(close());
  }
}

export async function listThreadMessagesRoute(
  env: ProjectRouteEnv,
  ctx: WaitUntilContext,
  request: Request,
  threadId: ThreadIdType,
  userId: UserId,
): Promise<Response> {
  const pagination = parsePagination(request, "messages");
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const rows = await withUserContext(db, userId, async (tx) => {
      await requireThread(tx, threadId, userId);
      return listThreadMessages(tx, {
        ...(pagination.cursor ? { cursor: pagination.cursor } : {}),
        limit: pagination.limit + 1,
        threadId,
        userId,
      });
    });
    const page = paginateRows(rows, pagination, "messages");
    return Response.json(
      Paginated(UIMessageRecordSchema).parse({
        ...page,
        // The cursor walks newest -> older, while each page remains directly
        // renderable in chronological order.
        data: [...page.data].reverse().map(messageResponse),
      }),
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
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
    throw projectNotFound();
  }
}

async function requireWritableProject(
  db: Parameters<typeof getProjectWriteState>[0],
  projectId: ProjectIdType,
  userId: UserId,
): Promise<void> {
  await lockUserProjectMutations(db, userId);
  const state = await getProjectWriteState(db, { projectId, userId });
  if (!state) {
    throw projectNotFound();
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
    throw threadNotFound();
  }
}

function projectResponse(project: ProjectSummaryRecord) {
  return {
    archiveAfter: project.archiveAfter?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    defaultModel: project.defaultModel,
    id: project.id,
    importRepoUrl: project.importRepoUrl ?? null,
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
    latestModelId: thread.latestModelId,
    pendingInitialPrompt:
      thread.projectId === null && thread.activeRunId === null
        ? (thread.launchIntent?.initialPrompt ?? null)
        : null,
    projectId: thread.projectId,
    title: thread.title,
    updatedAt: thread.updatedAt.toISOString(),
  };
}

function messageResponse(message: MessageRecord) {
  return {
    agentRunId: message.agentRunId,
    agentRunSegment: message.agentRunSegment,
    agentRunSegmentFinal: message.agentRunSegmentFinal,
    createdAt: message.createdAt.toISOString(),
    id: message.id,
    parts: message.parts,
    role: message.role,
    threadId: message.threadId,
  };
}

interface RoutePagination {
  cursor?: { at: string; id: string; segment?: number };
  limit: number;
}

function parsePagination(request: Request, kind: PageCursorKind): RoutePagination {
  const url = new URL(request.url);
  const parsed = PaginationQuerySchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    throw invalidQueryParam("Invalid pagination query", parsed.error);
  }
  if (parsed.data.cursor === undefined) {
    return { limit: parsed.data.limit };
  }
  const cursor = decodePageCursor(parsed.data.cursor, kind);
  return {
    cursor: {
      at: cursor.at,
      id: cursor.id,
      ...(cursor.kind === "messages" ? { segment: cursor.segment } : {}),
    },
    limit: parsed.data.limit,
  };
}

function paginateRows<T extends { agentRunSegment?: number; id: string; pageCursorAt: string }>(
  rows: T[],
  pagination: RoutePagination,
  kind: PageCursorKind,
): { data: T[]; has_more: boolean; next_cursor: string | null } {
  const hasMore = rows.length > pagination.limit;
  const data = hasMore ? rows.slice(0, pagination.limit) : rows;
  const last = data.at(-1);
  return {
    data,
    has_more: hasMore,
    next_cursor: hasMore && last ? encodePageCursor(pageCursorFromRow(last, kind)) : null,
  };
}

function pageCursorFromRow(
  row: { agentRunSegment?: number; id: string; pageCursorAt: string },
  kind: PageCursorKind,
): z.infer<typeof PageCursorSchema> {
  const identity = { at: row.pageCursorAt, id: row.id };
  if (kind === "messages") {
    if (!Number.isSafeInteger(row.agentRunSegment) || Number(row.agentRunSegment) < 0) {
      throw new TypeError("Message page row is missing its transcript segment.");
    }
    return { ...identity, kind, segment: Number(row.agentRunSegment), v: 2 };
  }
  return { ...identity, kind, v: 1 };
}

function decodePageCursor(value: string, expectedKind: PageCursorKind) {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
      throw new Error("invalid base64url");
    }
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const parsed = PageCursorSchema.parse(JSON.parse(atob(padded)) as unknown);
    if (parsed.kind !== expectedKind) {
      throw new Error("cursor kind mismatch");
    }
    return parsed;
  } catch {
    throw new APIError(400, "invalid_query_param", "Invalid pagination cursor", {
      hint: "Use next_cursor from the immediately preceding page of this collection.",
      retriable: false,
    });
  }
}

function encodePageCursor(cursor: z.infer<typeof PageCursorSchema>): string {
  return btoa(JSON.stringify(PageCursorSchema.parse(cursor)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function invalidRequestBody(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_request_body", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
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

function projectNotFound(): APIError {
  return new APIError(404, "not_found_project", "Project not found", { retriable: false });
}

function threadNotFound(): APIError {
  return new APIError(404, "not_found_thread", "Thread not found", { retriable: false });
}
