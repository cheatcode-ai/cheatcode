import { APIError, readJsonRequest } from "@cheatcode/observability";
import { BrowserTakeoverResumeSchema } from "@cheatcode/types";
import { type StartRunInput, StartRunInputSchema } from "./agent-run-schemas";
import { missingInternalUserResponse } from "./agent-run-utils";
import {
  type AgentRunWorkflowCallbackInput,
  AgentRunWorkflowCallbackInputSchema,
  type AgentRunWorkflowFailureInput,
  AgentRunWorkflowFailureInputSchema,
} from "./agent-run-workflow-protocol";
import { parseLastSeqParam } from "./run-state";

const INTERNAL_USER_HEADER = "X-Cheatcode-User-Id";
const MAX_START_RUN_REQUEST_BYTES = 128 * 1024;
const MAX_WORKFLOW_FAILURE_REQUEST_BYTES = 4 * 1024;
const MAX_WORKFLOW_EXECUTE_REQUEST_BYTES = 256 * 1024;
const MAX_BROWSER_TAKEOVER_REQUEST_BYTES = 4 * 1024;

type ResponseResult = Promise<Response> | Response;

export interface AgentRunHttpHandlers {
  cancel: (userId: string) => ResponseResult;
  browserTakeoverResume: (userId: string, takeoverId: string) => ResponseResult;
  browserTakeoverStart: (userId: string) => ResponseResult;
  browserTakeoverStatus: (userId: string) => ResponseResult;
  deleteAll: (userId: string) => ResponseResult;
  executeWorkflow: (input: AgentRunWorkflowCallbackInput) => ResponseResult;
  failWorkflow: (input: AgentRunWorkflowFailureInput) => ResponseResult;
  rolloverWorkflow: (input: AgentRunWorkflowCallbackInput) => ResponseResult;
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
    return handlers.status(userId);
  }
  if (url.pathname === "/browser-takeover") {
    const userId = internalUser(request);
    if (!userId) return missingInternalUserResponse("browser takeover");
    return handlers.browserTakeoverStatus(userId);
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
    return handlers.start(input);
  }
  if (pathname === "/workflow/execute") {
    return handleWorkflowExecute(request, handlers);
  }
  if (pathname === "/workflow/failed") {
    return handleWorkflowFailure(request, handlers);
  }
  if (pathname === "/workflow/rollover") {
    return handleWorkflowRollover(request, handlers);
  }
  if (pathname === "/browser-takeover/start") {
    const userId = internalUser(request);
    if (!userId) return missingInternalUserResponse("browser takeover");
    return handlers.browserTakeoverStart(userId);
  }
  if (pathname === "/browser-takeover/resume") {
    const userId = internalUser(request);
    if (!userId) return missingInternalUserResponse("browser takeover");
    const body = BrowserTakeoverResumeSchema.parse(
      await readJsonRequest(
        request,
        MAX_BROWSER_TAKEOVER_REQUEST_BYTES,
        "Browser takeover resume request",
      ),
    );
    return handlers.browserTakeoverResume(userId, body.takeoverId);
  }
  if (pathname !== "/cancel" && pathname !== "/delete-all") {
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
  return notFound();
}

async function handleWorkflowExecute(
  request: Request,
  handlers: AgentRunHttpHandlers,
): Promise<Response> {
  const input = AgentRunWorkflowCallbackInputSchema.parse(
    await readJsonRequest(
      request,
      MAX_WORKFLOW_EXECUTE_REQUEST_BYTES,
      "AgentRun Workflow execution request",
    ),
  );
  return handlers.executeWorkflow(input);
}

async function handleWorkflowFailure(
  request: Request,
  handlers: AgentRunHttpHandlers,
): Promise<Response> {
  const input = AgentRunWorkflowFailureInputSchema.parse(
    await readJsonRequest(
      request,
      MAX_WORKFLOW_FAILURE_REQUEST_BYTES,
      "AgentRun Workflow failure request",
    ),
  );
  return handlers.failWorkflow(input);
}

async function handleWorkflowRollover(
  request: Request,
  handlers: AgentRunHttpHandlers,
): Promise<Response> {
  const input = AgentRunWorkflowCallbackInputSchema.parse(
    await readJsonRequest(
      request,
      MAX_WORKFLOW_EXECUTE_REQUEST_BYTES,
      "AgentRun Workflow rollover request",
    ),
  );
  return handlers.rolloverWorkflow(input);
}

function postOperationName(pathname: string): "cancel" | "delete-all" {
  if (pathname === "/cancel") return "cancel";
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
