import {
  type DatabaseHandle,
  loadNavigationBootstrap,
  type NavigationProjectRecord,
  type WorkspaceThreadSearchRecord,
  withUserDb,
} from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { toThreadId, type UserId } from "@cheatcode/types";
import {
  NavigationBootstrapQuerySchema,
  NavigationBootstrapResponseSchema,
} from "@cheatcode/types/api";

/** Returns the complete bounded navigation snapshot after one auth and rate-limit decision. */
export async function navigationBootstrapRoute(
  database: DatabaseHandle,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const query = parseNavigationBootstrapQuery(request);
  return withUserDb(database, userId, async ({ transaction }) => {
    const snapshot = await transaction((db) =>
      loadNavigationBootstrap(db, {
        ...(query.activeThreadId ? { activeThreadId: toThreadId(query.activeThreadId) } : {}),
        userId,
      }),
    );
    return Response.json(
      NavigationBootstrapResponseSchema.parse({
        activeProjectId: snapshot.activeProjectId,
        projects: snapshot.projects.map(navigationProjectResponse),
        recentThreads: snapshot.recentThreads.map(recentThreadResponse),
      }),
    );
  });
}

function parseNavigationBootstrapQuery(request: Request) {
  const url = new URL(request.url);
  const parsed = NavigationBootstrapQuerySchema.safeParse({
    activeThreadId: url.searchParams.get("activeThreadId") ?? undefined,
  });
  if (!parsed.success) {
    throw new APIError(400, "request_query_param_invalid", "Invalid bootstrap query", {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  return parsed.data;
}

function navigationProjectResponse(project: NavigationProjectRecord) {
  return {
    archiveAfter: project.archiveAfter?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    defaultModel: project.defaultModel,
    id: project.id,
    importRepoUrl: project.importRepoUrl,
    latestThreadId: project.latestThreadId,
    mode: project.mode,
    name: project.name,
    overQuota: project.overQuota,
    readOnly: project.readOnly,
    updatedAt: project.updatedAt.toISOString(),
  };
}

function recentThreadResponse(thread: WorkspaceThreadSearchRecord) {
  return {
    activeRunId: thread.activeRunId,
    id: thread.id,
    projectId: thread.projectId,
    projectName: thread.projectName,
    title: thread.title,
    type: thread.type,
    updatedAt: thread.updatedAt.toISOString(),
  };
}
