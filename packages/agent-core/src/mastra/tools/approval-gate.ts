import { APIError, redactSecrets } from "@cheatcode/observability";
import { APPROVAL_BROKER_CONTEXT_KEY, type ApprovalBroker } from "./approval-context";

const TOOL_APPROVAL_TIMEOUT_MS = 5 * 60_000;
const APPROVAL_SUMMARY_MAX_CHARS = 400;
const COMMAND_PREVIEW_MAX_CHARS = 280;

/** Tools whose model-driven execution can mutate state or escape a read-only boundary. */
type ApprovalGatedToolName =
  | "browser_act"
  | "composio_execute"
  | "fs_delete"
  | "git_push"
  | "runCode"
  | "shell_exec"
  | "shell_kill_process"
  | "shell_start_process"
  | "shell_terminal"
  | "start_dev_server";

interface ToolApprovalPolicy {
  summary(input: unknown): string;
}

/**
 * One policy table is the authoritative sensitive-tool boundary. Adding a gated
 * call site without a matching policy is a compile-time error, while a missing
 * request-scoped broker fails closed at runtime.
 */
const TOOL_APPROVAL_POLICIES: Record<ApprovalGatedToolName, ToolApprovalPolicy> = {
  browser_act: {
    summary: (input) =>
      `Interact with the current browser page: ${commandPreview(stringField(asRecord(input), "instruction"))}.`,
  },
  composio_execute: {
    summary: (input) => composioSummary(input),
  },
  fs_delete: {
    summary: (input) => {
      const record = asRecord(input);
      const path = stringField(record, "path") || "the requested workspace path";
      return `Delete ${path}${record["recursive"] === true ? " recursively" : ""}.`;
    },
  },
  git_push: {
    summary: (input) => {
      const record = asRecord(input);
      const remote = stringField(record, "remote") || "origin";
      const branch = stringField(record, "branch");
      return `Push commits to ${remote}${branch ? ` (${branch})` : ""}.`;
    },
  },
  runCode: {
    summary: (input) => {
      const record = asRecord(input);
      const language = stringField(record, "language") || "sandbox";
      return `Run ${language} code: ${commandPreview(stringField(record, "code"))}`;
    },
  },
  shell_exec: { summary: (input) => `Run command: ${argvPreview(input)}.` },
  shell_kill_process: {
    summary: (input) =>
      `Stop sandbox process ${stringField(asRecord(input), "processId") || "(unknown)"}.`,
  },
  shell_start_process: { summary: (input) => `Start process: ${argvPreview(input)}.` },
  shell_terminal: {
    summary: (input) =>
      `Run terminal command: ${commandPreview(stringField(asRecord(input), "command"))}.`,
  },
  start_dev_server: { summary: (input) => `Start dev server: ${argvPreview(input)}.` },
};

interface ApprovalGateInput<Result> {
  context: unknown;
  execute: () => Promise<Result>;
  input: unknown;
  toolName: ApprovalGatedToolName;
}

/** Request approval before crossing a model-driven mutation boundary. */
export async function withApprovalGate<Result>({
  context,
  execute,
  input,
  toolName,
}: ApprovalGateInput<Result>): Promise<Result> {
  const broker = approvalBrokerFromToolContext(context);
  const toolCallId = toolCallIdFromContext(context);
  const decision = await broker.requestDecision({
    kind: "tool-approval",
    summary: approvalSummary(toolName, input),
    timeoutDecision: "deny",
    timeoutMs: TOOL_APPROVAL_TIMEOUT_MS,
    toolName,
    ...(toolCallId ? { toolCallId } : {}),
  });
  if (decision.decision !== "allow") {
    throw new APIError(403, "permission_denied", `Approval denied for ${toolName}.`, {
      details: { decidedBy: decision.decidedBy, toolName },
      hint: "The action was not executed. Adjust the request or explicitly allow it.",
      retriable: false,
    });
  }
  return execute();
}

function approvalBrokerFromToolContext(context: unknown): ApprovalBroker {
  const requestContext = asRecord(context)["requestContext"];
  const get = asRecord(requestContext)["get"];
  if (typeof get !== "function") {
    throw missingApprovalBrokerError();
  }
  const broker = get.call(requestContext, APPROVAL_BROKER_CONTEXT_KEY) as unknown;
  if (!isApprovalBroker(broker)) {
    throw missingApprovalBrokerError();
  }
  return broker;
}

function isApprovalBroker(value: unknown): value is ApprovalBroker {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { requestDecision?: unknown }).requestDecision === "function"
  );
}

function missingApprovalBrokerError(): APIError {
  return new APIError(
    500,
    "validation_tool_not_registered",
    "Sensitive tool execution requires an approval broker.",
    {
      hint: "Start the tool through an active AgentRun request context.",
      retriable: false,
    },
  );
}

function approvalSummary(toolName: ApprovalGatedToolName, input: unknown): string {
  return redactSecrets(TOOL_APPROVAL_POLICIES[toolName].summary(input))
    .trim()
    .slice(0, APPROVAL_SUMMARY_MAX_CHARS);
}

function composioSummary(input: unknown): string {
  const record = asRecord(input);
  const integration = stringField(record, "integration") || "connected integration";
  const toolSlug = stringField(record, "toolSlug") || "external action";
  const argumentCount = Object.keys(asRecord(record["arguments"])).length;
  return `Execute ${integration}/${toolSlug} with ${argumentCount} argument${argumentCount === 1 ? "" : "s"}.`;
}

function argvPreview(input: unknown): string {
  const command = asRecord(input)["command"];
  if (!Array.isArray(command)) {
    return "(unknown command)";
  }
  return commandPreview(
    command.filter((part): part is string => typeof part === "string").join(" "),
  );
}

function commandPreview(value: string): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim() || "(empty command)";
  return normalized.length <= COMMAND_PREVIEW_MAX_CHARS
    ? normalized
    : `${normalized.slice(0, COMMAND_PREVIEW_MAX_CHARS - 1)}…`;
}

function toolCallIdFromContext(context: unknown): string | undefined {
  const record = asRecord(context);
  const value = record["toolCallId"] ?? record["toolCallID"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
