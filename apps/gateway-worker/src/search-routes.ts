import {
  type DatabaseHandle,
  listRecentThreads,
  searchWorkspace,
  type WorkspaceSearchRecord,
  type WorkspaceThreadSearchRecord,
  withUserDb,
} from "@cheatcode/db";
import { APIError, createLogger } from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import {
  RecentThreadsQuerySchema,
  RecentThreadsResponseSchema,
  SearchQuerySchema,
  SearchResponseSchema,
  type SearchResult,
} from "@cheatcode/types/api";
import type { z } from "zod";

export async function searchWorkspaceRoute(
  database: DatabaseHandle,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const query = parseSearchQuery(request);
  const startedAt = performance.now();
  return withUserDb(database, userId, async ({ transaction }) => {
    const records = await transaction((tx) =>
      searchWorkspace(tx, userId, { limit: query.limit, q: query.q }),
    );
    const results = records.map(toSearchResult);
    const response = SearchResponseSchema.parse({ query: query.q, results });
    logSearchPerformed(request, query.q, results, performance.now() - startedAt);
    return Response.json(response);
  });
}

/** `GET /v1/threads?limit=N` — the user's recent chats (threads) across all projects. */
export async function listRecentThreadsRoute(
  database: DatabaseHandle,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const limit = parseRecentThreadsLimit(request);
  return withUserDb(database, userId, async ({ transaction }) => {
    const records = await transaction((tx) => listRecentThreads(tx, userId, limit));
    const response = RecentThreadsResponseSchema.parse({
      threads: records.map(toThreadResult),
    });
    return Response.json(response);
  });
}

function toThreadResult(record: WorkspaceThreadSearchRecord): SearchResult {
  return {
    activeRunId: record.activeRunId,
    id: record.id,
    projectId: record.projectId,
    projectName: record.projectName,
    title: record.title,
    type: "thread",
    updatedAt: record.updatedAt.toISOString(),
  };
}

function parseRecentThreadsLimit(request: Request): number {
  const url = new URL(request.url);
  const parsed = RecentThreadsQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    throw invalidQueryParam("Invalid threads query", parsed.error);
  }
  return parsed.data.limit;
}

function toSearchResult(record: WorkspaceSearchRecord): SearchResult {
  if (record.type === "project") {
    return {
      id: record.id,
      latestThreadId: record.latestThreadId,
      name: record.name,
      type: "project",
      updatedAt: record.updatedAt.toISOString(),
    };
  }
  return {
    activeRunId: record.activeRunId,
    id: record.id,
    projectId: record.projectId,
    projectName: record.projectName,
    title: record.title,
    type: "thread",
    updatedAt: record.updatedAt.toISOString(),
  };
}

function parseSearchQuery(request: Request): { limit: number; q: string } {
  const url = new URL(request.url);
  const parsed = SearchQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
  });
  if (!parsed.success) {
    throw invalidQueryParam("Invalid search query", parsed.error);
  }
  return parsed.data;
}

function logSearchPerformed(
  request: Request,
  q: string,
  results: SearchResult[],
  durationMs: number,
): void {
  const requestId = request.headers.get("X-Request-Id");
  createLogger(requestId ? { requestId } : {}).info("search_performed", {
    durationMs: Math.round(durationMs),
    projectHits: results.filter((result) => result.type === "project").length,
    qLength: q.length,
    threadHits: results.filter((result) => result.type === "thread").length,
  });
}

function invalidQueryParam(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_query_param", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}
