import { APIError, readJsonRequest } from "@cheatcode/observability";
import { type ApprovalDecisionInput, ApprovalDecisionInputSchema } from "./agent-run-approvals";
import { type StartRunInput, StartRunInputSchema } from "./agent-run-schemas";
import { missingInternalUserResponse } from "./agent-run-utils";
import { parseLastSeqParam } from "./run-state";

const INTERNAL_USER_HEADER = "X-Cheatcode-User-Id";
const MAX_APPROVAL_REQUEST_BYTES = 4 * 1024;
const MAX_START_RUN_REQUEST_BYTES = 128 * 1024;

type ResponseResult = Promise<Response> | Response;

export interface AgentRunHttpHandlers {
  approval: (userId: string, body: ApprovalDecisionInput) => ResponseResult;
  cancel: (userId: string) => ResponseResult;
  deleteAll: (userId: string) => ResponseResult;
  finalizeDetachedRun: () => Promise<void>;
  resume: (userId: string, lastSeq: number) => ResponseResult;
  start: (input: StartRunInput) => ResponseResult;
  status: (userId: string) => ResponseResult;
}

/** HTTP adapter for the run-keyed Durable Object. */
export async function handleAgentRunRequest(
  request: Request,
  handlers: AgentRunHttpHandlers,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET") {
    return handleGet(request, url, handlers);
  }
  if (request.method === "POST") {
    return handlePost(request, url.pathname, handlers);
  }
  return notFound();
}

async function handleGet(
  request: Request,
  url: URL,
  handlers: AgentRunHttpHandlers,
): Promise<Response> {
  if (url.pathname === "/status") {
    const userId = internalUser(request);
    if (!userId) {
      return missingInternalUserResponse("status");
    }
    await handlers.finalizeDetachedRun();
    return handlers.status(userId);
  }
  if (url.pathname === "/stream") {
    return handleStream(request, url, handlers);
  }
  return notFound();
}

async function handleStream(
  request: Request,
  url: URL,
  handlers: AgentRunHttpHandlers,
): Promise<Response> {
  const lastSeq = parseLastSeqParam(url.searchParams.get("lastSeq"));
  if (lastSeq === null) {
    return invalidResumeCursorResponse();
  }
  const userId = internalUser(request);
  if (!userId) {
    return missingInternalUserResponse("streams");
  }
  await handlers.finalizeDetachedRun();
  return handlers.resume(userId, lastSeq);
}

async function handlePost(
  request: Request,
  pathname: string,
  handlers: AgentRunHttpHandlers,
): Promise<Response> {
  if (pathname === "/start") {
    const input = StartRunInputSchema.parse(
      await readJsonRequest(request, MAX_START_RUN_REQUEST_BYTES, "Agent run start request"),
    );
    await handlers.finalizeDetachedRun();
    return handlers.start(input);
  }
  if (pathname !== "/cancel" && pathname !== "/approval" && pathname !== "/delete-all") {
    return notFound();
  }
  const userId = internalUser(request);
  if (!userId) {
    return missingInternalUserResponse(postOperationName(pathname));
  }
  if (pathname === "/cancel") {
    return handlers.cancel(userId);
  }
  if (pathname === "/delete-all") {
    return handlers.deleteAll(userId);
  }
  if (pathname === "/approval") {
    return handleApproval(request, userId, handlers);
  }
  return notFound();
}

async function handleApproval(
  request: Request,
  userId: string,
  handlers: AgentRunHttpHandlers,
): Promise<Response> {
  const body = ApprovalDecisionInputSchema.parse(
    await readJsonRequest(request, MAX_APPROVAL_REQUEST_BYTES, "Approval decision request"),
  );
  return handlers.approval(userId, body);
}

function postOperationName(pathname: string): "approval" | "cancel" | "delete-all" {
  if (pathname === "/cancel") return "cancel";
  if (pathname === "/approval") return "approval";
  return "delete-all";
}

function invalidResumeCursorResponse(): Response {
  return new APIError(400, "invalid_query_param", "Invalid resume cursor", {
    hint: "Pass lastSeq as a non-negative integer.",
    retriable: false,
  }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
}

function internalUser(request: Request): string | null {
  return request.headers.get(INTERNAL_USER_HEADER);
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
