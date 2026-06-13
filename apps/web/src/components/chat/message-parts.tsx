import type { CheatcodeUIMessage } from "@cheatcode/types";
import type { ReactNode } from "react";
import { Response as MarkdownResponse } from "@/components/ai-elements/response";
import {
  ApprovalDecisionBlock,
  ApprovalRequestBlock,
  ModelFallbackBlock,
} from "@/components/chat/approval-parts";
import { Download, ExternalLink } from "@/components/ui/icons";

const MAX_TOOL_STRING_LENGTH = 600;
const MAX_TOOL_ARRAY_ITEMS = 6;
const MAX_TOOL_OBJECT_KEYS = 16;
const LARGE_TOOL_FIELDS = new Set([
  "base64",
  "code",
  "componentSource",
  "data",
  "logs",
  "stderr",
  "stdout",
  "svg",
]);

type MessagePart = CheatcodeUIMessage["parts"][number];
type ArtifactData = Extract<MessagePart, { type: "data-artifact" }>["data"];
type SandboxStatusData = Extract<MessagePart, { type: "data-sandbox-status" }>["data"];
type PlanData = Extract<MessagePart, { type: "data-plan" }>["data"];
type QuotaData = Extract<MessagePart, { type: "data-quota" }>["data"];
type TaskStatusData = Extract<MessagePart, { type: "data-task-status" }>["data"];
type TakeoverData = Extract<MessagePart, { type: "data-takeover" }>["data"];
type TaskStatusById = ReadonlyMap<string, TaskStatusData>;

export function MessageParts({ message }: { message: CheatcodeUIMessage }) {
  const taskStatusById = collectTaskStatuses(message.parts);
  const resolvedApprovalIds = collectResolvedApprovals(message.parts);
  const hasPlan = message.parts.some((part) => part.type === "data-plan");

  return (
    <div className="space-y-3">
      {message.parts.map((part, partIndex) => (
        <MessagePartView
          hideTaskStatusBlocks={hasPlan}
          key={partKey(message.id, part, partIndex)}
          part={part}
          resolvedApprovalIds={resolvedApprovalIds}
          taskStatusById={taskStatusById}
        />
      ))}
    </div>
  );
}

function MessagePartView({
  hideTaskStatusBlocks,
  part,
  resolvedApprovalIds,
  taskStatusById,
}: {
  hideTaskStatusBlocks: boolean;
  part: MessagePart;
  resolvedApprovalIds: ReadonlySet<string>;
  taskStatusById: TaskStatusById;
}) {
  if (part.type === "text") {
    return (
      <div className="chat-markdown max-w-none font-mono text-xs text-zinc-300 leading-relaxed tracking-wide">
        <MarkdownResponse>{part.text}</MarkdownResponse>
      </div>
    );
  }

  if (part.type === "data-error") {
    return <DataBlock tone="error" title={part.data.code} value={part.data.message} />;
  }

  if (part.type === "data-thinking") {
    return <DataBlock title={part.data.delta ? "thinking" : "thought"} value={part.data.text} />;
  }

  if (part.type === "data-sandbox-status") {
    return <SandboxStatusBlock data={part.data} />;
  }

  if (part.type === "data-artifact") {
    return <ArtifactBlock data={part.data} />;
  }

  if (part.type === "data-budget") {
    return <DataBlock title="budget" value={formatBudget(part.data)} />;
  }

  if (part.type === "data-plan") {
    return <PlanBlock data={part.data} taskStatusById={taskStatusById} />;
  }

  if (part.type === "data-task-status") {
    return <TaskStatusPart data={part.data} hidden={hideTaskStatusBlocks} />;
  }

  if (part.type === "data-quota") {
    return <QuotaBlock data={part.data} />;
  }

  if (part.type === "data-takeover") {
    return <TakeoverBlock data={part.data} />;
  }

  const approvalView = renderApprovalPart(part, resolvedApprovalIds);
  if (approvalView !== null) {
    return approvalView;
  }

  if (part.type === "data-seq") {
    return null;
  }

  if (part.type.startsWith("tool-")) {
    return <DataBlock title={part.type.replace("tool-", "")} value={toolPayload(part)} />;
  }

  return <DataBlock title={part.type} value={formatUnknown(part)} />;
}

function renderApprovalPart(
  part: MessagePart,
  resolvedApprovalIds: ReadonlySet<string>,
): ReactNode {
  if (part.type === "data-approval-request") {
    return (
      <ApprovalRequestBlock
        data={part.data}
        resolved={resolvedApprovalIds.has(part.data.approvalId)}
      />
    );
  }
  if (part.type === "data-approval-decision") {
    return <ApprovalDecisionBlock data={part.data} />;
  }
  if (part.type === "data-model-fallback") {
    return <ModelFallbackBlock data={part.data} />;
  }
  return null;
}

function TaskStatusPart({ data, hidden }: { data: TaskStatusData; hidden: boolean }) {
  if (hidden) {
    return null;
  }
  return <TaskStatusBlock data={data} />;
}

function PlanBlock({ data, taskStatusById }: { data: PlanData; taskStatusById: TaskStatusById }) {
  return (
    <div className="border-thread-border border-l bg-[var(--thread-code-bg)] p-3 font-mono text-[11px] text-thread-text-secondary">
      <div className="mb-3 text-[9px] text-thread-text-muted uppercase tracking-[0.28em]">plan</div>
      <div className="space-y-2">
        {data.tasks.map((task) => {
          const update = taskStatusById.get(task.id);
          const status = update?.status ?? task.status;
          return (
            <div className="flex items-start gap-3" key={task.id}>
              <span className={statusDotClass(status)} />
              <div className="min-w-0 flex-1">
                <div className="text-thread-text-primary">{task.title}</div>
                <div className="mt-1 text-[9px] text-thread-text-muted uppercase tracking-[0.2em]">
                  {status}
                </div>
                {update?.error ? <div className="mt-1 text-red-300">{update.error}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
      {data.parallelGroups.length > 0 ? (
        <div className="mt-3 text-[10px] text-thread-text-muted">
          {data.parallelGroups.length} execution group{data.parallelGroups.length === 1 ? "" : "s"}
        </div>
      ) : null}
    </div>
  );
}

function collectTaskStatuses(parts: MessagePart[]): TaskStatusById {
  const statuses = new Map<string, TaskStatusData>();
  for (const part of parts) {
    if (part.type === "data-task-status") {
      statuses.set(part.data.taskId, part.data);
    }
  }
  return statuses;
}

function collectResolvedApprovals(parts: MessagePart[]): ReadonlySet<string> {
  const resolved = new Set<string>();
  for (const part of parts) {
    if (part.type === "data-approval-decision") {
      resolved.add(part.data.approvalId);
    }
  }
  return resolved;
}

function TaskStatusBlock({ data }: { data: TaskStatusData }) {
  return (
    <DataBlock
      title={`task ${data.status}`}
      value={[`id: ${data.taskId}`, data.error ? `error: ${data.error}` : ""]
        .filter(Boolean)
        .join("\n")}
    />
  );
}

function SandboxStatusBlock({ data }: { data: SandboxStatusData }) {
  return <DataBlock title="sandbox" value={sandboxStatusSummary(data)} />;
}

function sandboxStatusSummary(data: SandboxStatusData): string {
  const lines: string[] = [data.status];
  if (data.previewUrl) {
    lines.push(`preview: ${data.previewUrl}`);
  }
  if (data.expoUrl) {
    lines.push(`expo go: ${data.expoUrl}`);
  }
  return lines.join("\n");
}

function QuotaBlock({ data }: { data: QuotaData }) {
  const remaining = Math.max(0, data.remaining);
  return (
    <DataBlock
      title="quota"
      value={[
        `${data.feature}: ${remaining.toLocaleString()} / ${data.limit.toLocaleString()} remaining`,
        `resets: ${new Date(data.resetAt * 1000).toLocaleString()}`,
      ].join("\n")}
    />
  );
}

function TakeoverBlock({ data }: { data: TakeoverData }) {
  if (!data.available || !data.vncUrl) {
    return <DataBlock title="takeover" value="not available" />;
  }
  return (
    <div className="border-thread-border border-l bg-[var(--thread-code-bg)] p-3 font-mono text-[11px] text-thread-text-secondary">
      <div className="mb-2 text-[9px] text-thread-text-muted uppercase tracking-[0.28em]">
        takeover
      </div>
      <a
        className="inline-flex items-center gap-2 text-thread-accent underline-offset-4 hover:underline"
        href={data.vncUrl}
        rel="noreferrer"
        target="_blank"
      >
        open private browser
        <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
      </a>
      {data.resumeToken ? (
        <div className="mt-2 text-[10px] text-thread-text-muted">Resume token issued.</div>
      ) : null}
    </div>
  );
}

function ArtifactBlock({ data }: { data: ArtifactData }) {
  const label = data.filename ?? artifactFallbackName(data);
  const sizeLabel = typeof data.sizeBytes === "number" ? formatBytes(data.sizeBytes) : null;

  return (
    <div className="border-thread-border border-l bg-[var(--thread-code-bg)] p-3 font-mono text-[11px] text-thread-text-secondary">
      <div className="mb-2 text-[9px] text-thread-text-muted uppercase tracking-[0.28em]">
        artifact
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-thread-text-primary">{label}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-thread-text-muted">
            <span>{data.kind}</span>
            <span>{data.mimeType}</span>
            {sizeLabel ? <span>{sizeLabel}</span> : null}
          </div>
        </div>
        <a
          className="inline-flex shrink-0 items-center gap-1.5 text-thread-accent underline-offset-4 hover:underline"
          download
          href={data.downloadUrl}
          rel="noreferrer"
          target="_blank"
        >
          <Download aria-hidden="true" className="h-3.5 w-3.5" />
          download
        </a>
      </div>
    </div>
  );
}

function artifactFallbackName(data: ArtifactData): string {
  const extension = artifactExtension(data.kind, data.mimeType);
  return extension ? `${data.kind}-${data.outputId.slice(0, 8)}.${extension}` : data.kind;
}

function artifactExtension(kind: ArtifactData["kind"], mimeType: string): string | null {
  if (kind === "slide") {
    return "pptx";
  }
  if (kind === "xlsx" || kind === "docx" || kind === "pdf") {
    return kind;
  }
  if (mimeType === "image/svg+xml") {
    return "svg";
  }
  if (mimeType.includes("/")) {
    const extension = mimeType.split("/").at(1)?.split(";").at(0);
    return extension?.replace(/[^a-z0-9]+/gi, "").toLowerCase() || null;
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units.at(-1)) {
      return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}

function statusDotClass(status: TaskStatusData["status"]): string {
  const base = "mt-1.5 h-2 w-2 shrink-0 rounded-full";
  if (status === "completed") {
    return `${base} bg-emerald-400`;
  }
  if (status === "running") {
    return `${base} bg-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.55)]`;
  }
  if (status === "failed" || status === "canceled") {
    return `${base} bg-red-400`;
  }
  return `${base} bg-thread-text-muted`;
}

function DataBlock({
  title,
  tone = "default",
  value,
}: {
  title: string;
  tone?: "default" | "error";
  value: string;
}) {
  return (
    <div
      className={
        tone === "error"
          ? "border border-[var(--thread-status-error-border)] bg-[var(--thread-status-error-bg)] p-3 font-mono text-[11px] text-red-300"
          : "border-thread-border border-l bg-[var(--thread-code-bg)] p-3 font-mono text-[11px] text-thread-text-secondary"
      }
    >
      <div className="mb-2 text-[9px] text-thread-text-muted uppercase tracking-[0.28em]">
        {title}
      </div>
      <pre className="whitespace-pre-wrap break-words">{value}</pre>
    </div>
  );
}

function formatBudget(data: {
  capUsd: number;
  tokensIn: number;
  tokensOut: number;
  usdSpent: number;
}) {
  return [
    `spent: $${data.usdSpent.toFixed(4)} / $${data.capUsd.toFixed(2)}`,
    `tokens: ${data.tokensIn.toLocaleString()} in, ${data.tokensOut.toLocaleString()} out`,
  ].join("\n");
}

function toolPayload(part: MessagePart): string {
  const record = asRecord(part);
  const output = record["output"] ?? record["result"] ?? record["input"] ?? record;
  return formatUnknown(summarizeToolValue(output, 0));
}

function partKey(messageId: string, part: MessagePart, partIndex: number): string {
  if (part.type === "text") {
    return `${messageId}:${partIndex}:text:${part.text.slice(0, 80)}`;
  }
  if (part.type === "data-artifact") {
    return `${messageId}:${partIndex}:artifact:${part.data.outputId}`;
  }
  if (part.type === "data-seq") {
    return `${messageId}:${partIndex}:seq:${part.data.seq}`;
  }
  if (part.type.startsWith("tool-")) {
    const record = asRecord(part);
    const id =
      stringRecordField(record, "toolCallId") ||
      stringRecordField(record, "id") ||
      stringRecordField(record, "state");
    return `${messageId}:${partIndex}:${part.type}:${id}`;
  }
  return `${messageId}:${partIndex}:${part.type}:${formatUnknown(part).slice(0, 120)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeToolValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return summarizeString(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= 3) {
    return "[nested object]";
  }
  if (Array.isArray(value)) {
    const visible = value
      .slice(0, MAX_TOOL_ARRAY_ITEMS)
      .map((item) => summarizeToolValue(item, depth + 1));
    return value.length > MAX_TOOL_ARRAY_ITEMS
      ? [...visible, `[${value.length - MAX_TOOL_ARRAY_ITEMS} more item(s)]`]
      : visible;
  }

  const entries = Object.entries(asRecord(value));
  const summarized: Record<string, unknown> = {};
  for (const [key, entryValue] of entries.slice(0, MAX_TOOL_OBJECT_KEYS)) {
    if (typeof entryValue === "string" && LARGE_TOOL_FIELDS.has(key)) {
      summarized[key] = summarizeLargeField(key, entryValue);
      continue;
    }
    summarized[key] = summarizeToolValue(entryValue, depth + 1);
  }
  if (entries.length > MAX_TOOL_OBJECT_KEYS) {
    summarized["more"] = `${entries.length - MAX_TOOL_OBJECT_KEYS} more field(s)`;
  }
  return summarized;
}

function summarizeString(value: string): string {
  return value.length > MAX_TOOL_STRING_LENGTH
    ? `${value.slice(0, MAX_TOOL_STRING_LENGTH)}... [${value.length.toLocaleString()} chars]`
    : value;
}

function summarizeLargeField(key: string, value: string): string {
  return value.length > MAX_TOOL_STRING_LENGTH
    ? `[${key}: ${value.length.toLocaleString()} chars] ${value.slice(0, 160)}...`
    : value;
}

function stringRecordField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
