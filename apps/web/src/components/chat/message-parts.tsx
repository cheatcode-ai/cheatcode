"use client";

import type { CheatcodeUIMessage } from "@cheatcode/types";
import { type ReactNode, useState } from "react";
import { Response as MarkdownResponse } from "@/components/ai-elements/response";
import {
  ApprovalDecisionBlock,
  ApprovalRequestBlock,
  ModelFallbackBlock,
} from "@/components/chat/approval-parts";
import {
  ChevronDown,
  Code,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Folder,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Presentation,
} from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

const MAX_TOOL_STRING_LENGTH = 600;
const MAX_TOOL_ARRAY_ITEMS = 6;
const MAX_TOOL_OBJECT_KEYS = 16;
const MAX_TOOL_ARG_LENGTH = 96;
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
type TakeoverData = Extract<MessagePart, { type: "data-takeover" }>["data"];
type ThinkingData = Extract<MessagePart, { type: "data-thinking" }>["data"];

type RenderItem =
  | { kind: "tools"; key: string; parts: MessagePart[] }
  | { kind: "part"; key: string; part: MessagePart };

export function MessageParts({
  message,
  streaming,
}: {
  message: CheatcodeUIMessage;
  streaming: boolean;
}) {
  const resolvedApprovalIds = collectResolvedApprovals(message.parts);
  const { items } = buildTimeline(message.id, message.parts, streaming);
  const deliverables = message.parts
    .filter((part) => part.type === "data-artifact")
    .map((part) => (part as Extract<MessagePart, { type: "data-artifact" }>).data);

  return (
    <div className="space-y-3">
      {items.map((item) =>
        item.kind === "activity" ? (
          <ActivityDisclosure key={item.key} parts={item.parts} streaming={streaming} />
        ) : (
          <MessagePartView
            key={item.key}
            part={item.part}
            resolvedApprovalIds={resolvedApprovalIds}
          />
        ),
      )}
      {deliverables.length > 0 ? <DeliverablesBlock items={deliverables} /> : null}
    </div>
  );
}

type TimelineItem =
  | { kind: "activity"; key: string; parts: MessagePart[] }
  | { kind: "part"; key: string; part: MessagePart };

/**
 * Split an assistant message into its working ACTIVITY and its final ANSWER (bud parity).
 * The last non-empty text segment is the answer; every earlier text segment, tool call,
 * and thought is a working step folded into a collapsed activity disclosure. Interactive
 * parts (errors, approvals, takeover) break the run and render inline in place. Chrome
 * (`data-sandbox-status`/plan/budget…), resume markers, and artifacts are transparent
 * (artifacts are collected into the trailing Deliverables block).
 */
function buildTimeline(
  messageId: string,
  parts: MessagePart[],
  streaming: boolean,
): { items: TimelineItem[]; hasAnswer: boolean } {
  // While the run is live, keep every part inside the (auto-expanded) activity
  // disclosure so steps stream in without the final-answer segment popping in and out
  // as the model alternates text and tools. The answer is extracted once it settles.
  const finalAnswerIndex = streaming ? -1 : lastAnswerTextIndex(parts);
  const items: TimelineItem[] = [];
  let activity: { parts: MessagePart[]; startIndex: number } | null = null;
  const flush = () => {
    if (activity) {
      items.push({
        kind: "activity",
        key: `${messageId}:activity:${activity.startIndex}`,
        parts: activity.parts,
      });
      activity = null;
    }
  };
  parts.forEach((part, index) => {
    if (part.type === "data-seq" || part.type === "data-artifact" || isHiddenPart(part)) {
      return;
    }
    if (index === finalAnswerIndex || !isStepPart(part)) {
      flush();
      items.push({ kind: "part", key: partKey(messageId, part, index), part });
      return;
    }
    if (!activity) {
      activity = { parts: [], startIndex: index };
    }
    activity.parts.push(part);
  });
  flush();
  return { items, hasAnswer: finalAnswerIndex >= 0 };
}

/**
 * The final answer is the model's closing prose. Prefer the TRAILING narration — the last
 * non-empty text segment with no tool/thought after it (the clean "Done, I built…" case).
 * If the run ended on a tool with no closing text, fall back to the last non-empty text
 * segment so an answer still surfaces rather than an empty disclosure. -1 means no text at all.
 */
function lastAnswerTextIndex(parts: MessagePart[]): number {
  const trailing = trailingTextIndex(parts);
  return trailing === -1 ? lastNonEmptyTextIndex(parts) : trailing;
}

/** The last non-empty text segment reachable from the end before any tool/thought. */
function trailingTextIndex(parts: MessagePart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (isNonEmptyText(part)) {
      return index;
    }
    if (part && (isToolPart(part) || part.type === "data-thinking")) {
      return -1;
    }
  }
  return -1;
}

function lastNonEmptyTextIndex(parts: MessagePart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (isNonEmptyText(parts[index])) {
      return index;
    }
  }
  return -1;
}

function isNonEmptyText(
  part: MessagePart | undefined,
): part is Extract<MessagePart, { type: "text" }> {
  return part?.type === "text" && part.text.trim().length > 0;
}

/** Working steps folded into the disclosure: intermediate narration, tool calls, thoughts. */
function isStepPart(part: MessagePart): boolean {
  return part.type === "text" || part.type === "data-thinking" || isToolPart(part);
}

/** Internal chrome that never renders in the transcript (mirrors MessagePartView's nulls). */
function isHiddenPart(part: MessagePart): boolean {
  return (
    part.type === "data-sandbox-status" ||
    part.type === "data-budget" ||
    part.type === "data-plan" ||
    part.type === "data-task-status" ||
    part.type === "data-quota"
  );
}

// ---------------------------------------------------------------------------
// Activity disclosure — collapsed "Worked · N steps" timeline (bud parity)
// ---------------------------------------------------------------------------

function ActivityDisclosure({ parts, streaming }: { parts: MessagePart[]; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const isOpen = open || streaming;
  const toolCount = parts.filter((part) => isToolPart(part)).length;
  const rows = buildActivityRows(parts);
  const label = streaming ? "Working…" : activityLabel(rows.length, toolCount);

  return (
    <div className="cc-fade-in">
      <button
        className="group flex items-center gap-1.5 text-[#9b9b9b] text-[13px] transition-colors hover:text-[#585858]"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {streaming ? (
          <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
        ) : (
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-3 w-3 text-[#c4c4c4] transition-transform group-hover:text-[#9b9b9b]",
              isOpen ? "" : "-rotate-90",
            )}
          />
        )}
        <span className="font-medium">{label}</span>
      </button>
      {isOpen ? (
        <div className="mt-2 ml-[5px] space-y-2 border-[#ececec] border-l pl-4">
          {rows.map((row) =>
            row.kind === "tools" ? (
              <ToolGroup key={row.key} parts={row.parts} />
            ) : row.part.type === "data-thinking" ? (
              <ThinkingBlock data={(row.part as { data: ThinkingData }).data} key={row.key} />
            ) : (
              <ActivityNarration key={row.key} text={(row.part as { text: string }).text} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function ActivityNarration({ text }: { text: string }) {
  if (text.trim().length === 0) {
    return null;
  }
  return (
    <div className="chat-markdown max-w-none text-[#707070] text-[13px] leading-6">
      <MarkdownResponse>{text}</MarkdownResponse>
    </div>
  );
}

function activityLabel(stepCount: number, toolCount: number): string {
  if (toolCount > 0) {
    return `Worked · ${toolCount} tool call${toolCount === 1 ? "" : "s"}`;
  }
  return `Worked · ${stepCount} step${stepCount === 1 ? "" : "s"}`;
}

/** Cluster consecutive tool parts into one ToolGroup; text/thought steps stay standalone. */
function buildActivityRows(parts: MessagePart[]): RenderItem[] {
  const rows: RenderItem[] = [];
  let run: { parts: MessagePart[]; startIndex: number } | null = null;
  const flush = () => {
    if (run) {
      rows.push({ kind: "tools", key: `tools:${run.startIndex}`, parts: run.parts });
      run = null;
    }
  };
  parts.forEach((part, index) => {
    if (isToolPart(part)) {
      if (!run) {
        run = { parts: [], startIndex: index };
      }
      run.parts.push(part);
      return;
    }
    flush();
    rows.push({ kind: "part", key: `step:${index}`, part });
  });
  flush();
  return rows;
}

function isToolPart(part: MessagePart): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool" || part.type === "data-tool";
}

function MessagePartView({
  part,
  resolvedApprovalIds,
}: {
  part: MessagePart;
  resolvedApprovalIds: ReadonlySet<string>;
}) {
  if (part.type === "text") {
    return (
      <div className="chat-markdown max-w-none text-[#1b1b1b] text-[14px] leading-6">
        <MarkdownResponse>{part.text}</MarkdownResponse>
      </div>
    );
  }

  if (part.type === "data-error") {
    return <DataBlock tone="error" title={part.data.code} value={part.data.message} />;
  }

  if (part.type === "data-thinking") {
    return <ThinkingBlock data={part.data} />;
  }

  // Internal orchestration plumbing is not shown in the transcript (bud parity):
  // the plan/task-status/budget/quota are agent bookkeeping, sandbox state lives in
  // the Computer panel, and data-artifact is collected into the Deliverables block.
  if (
    part.type === "data-sandbox-status" ||
    part.type === "data-artifact" ||
    part.type === "data-budget" ||
    part.type === "data-plan" ||
    part.type === "data-task-status" ||
    part.type === "data-quota"
  ) {
    return null;
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

  if (isToolPart(part)) {
    return <ToolGroup parts={[part]} />;
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

// ---------------------------------------------------------------------------
// Thinking / reasoning — collapsed "Thought for Xs" row (bud parity)
// ---------------------------------------------------------------------------

function ThinkingBlock({ data }: { data: ThinkingData }) {
  const [open, setOpen] = useState(false);
  const streaming = data.delta;
  const label = streaming
    ? "Thinking…"
    : typeof data.durationMs === "number" && data.durationMs > 0
      ? `Thought for ${formatThinkingDuration(data.durationMs)}`
      : "Thought";
  const canExpand = !streaming && data.text.trim().length > 0;

  return (
    <div className="cc-fade-in">
      <button
        className="flex items-center gap-1.5 text-[#9b9b9b] text-[13px] transition-colors hover:text-[#585858] disabled:cursor-default disabled:hover:text-[#9b9b9b]"
        disabled={!canExpand}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {streaming ? (
          <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
        ) : (
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-3 w-3 text-[#b8b8b8] transition-transform",
              canExpand ? "" : "opacity-0",
              open ? "" : "-rotate-90",
            )}
          />
        )}
        <span className="font-medium">{label}</span>
      </button>
      {open && canExpand ? (
        <div className="mt-1.5 ml-[18px] whitespace-pre-wrap border-[#ececec] border-l pl-3 text-[#707070] text-[13px] leading-6">
          {data.text}
        </div>
      ) : null}
    </div>
  );
}

function formatThinkingDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

// ---------------------------------------------------------------------------
// Tool calls — semantic "Read <path> (+N more)" rows (bud parity)
// ---------------------------------------------------------------------------

type ToolVerbSpec = { verb: string; argKeys?: string[] };

const TOOL_VERBS: Record<string, ToolVerbSpec> = {
  runCode: { verb: "Ran", argKeys: ["code"] },
  fs_read: { verb: "Read", argKeys: ["path", "file", "filePath"] },
  fs_write: { verb: "Wrote", argKeys: ["path", "file", "filePath"] },
  fs_delete: { verb: "Deleted", argKeys: ["path", "file"] },
  fs_list: { verb: "Listed", argKeys: ["path", "dir", "directory"] },
  fs_search: { verb: "Searched files", argKeys: ["query", "pattern", "q"] },
  shell_exec: { verb: "Ran", argKeys: ["command", "cmd"] },
  shell_terminal: { verb: "Ran", argKeys: ["command", "cmd"] },
  shell_start_process: { verb: "Started", argKeys: ["command", "cmd"] },
  shell_kill_process: { verb: "Stopped a process" },
  start_dev_server: { verb: "Started the dev server" },
  git_clone: { verb: "Cloned", argKeys: ["repo", "url"] },
  git_commit: { verb: "Committed", argKeys: ["message"] },
  git_push: { verb: "Pushed changes" },
  git_status: { verb: "Checked git status" },
  browser_open: { verb: "Opened", argKeys: ["url"] },
  browser_act: { verb: "Acted in the browser", argKeys: ["action", "instruction"] },
  browser_extract: { verb: "Extracted from a page", argKeys: ["url"] },
  browser_observe: { verb: "Observed a page" },
  browser_screenshot: { verb: "Captured a screenshot" },
  data_analyze_csv: { verb: "Analyzed", argKeys: ["path", "file"] },
  data_chart: { verb: "Built a chart" },
  data_scrape_to_csv: { verb: "Scraped to CSV", argKeys: ["url"] },
  docs_generate_docx: { verb: "Generated a document" },
  docs_generate_pdf: { verb: "Generated a PDF" },
  docs_generate_slides: { verb: "Generated slides" },
  docs_generate_xlsx: { verb: "Generated a spreadsheet" },
  firecrawl_scrape: { verb: "Scraped", argKeys: ["url"] },
  firecrawl_search: { verb: "Searched the web", argKeys: ["query", "q"] },
  firecrawl_extract: { verb: "Extracted", argKeys: ["url"] },
  search_web: { verb: "Searched the web", argKeys: ["query", "q"] },
  search_web_advanced: { verb: "Searched the web", argKeys: ["query", "q"] },
  search_company: { verb: "Researched a company", argKeys: ["company", "name", "query"] },
  research_competitor: { verb: "Researched competitors", argKeys: ["query", "company"] },
  research_deep: { verb: "Researched", argKeys: ["query", "topic"] },
  research_fanout: { verb: "Researched", argKeys: ["query", "topic"] },
  composio_execute: { verb: "Ran an app action", argKeys: ["tool", "action", "slug"] },
  composio_list_tools: { verb: "Listed app actions" },
  sandbox_create: { verb: "Created the sandbox" },
  sandbox_destroy: { verb: "Tore down the sandbox" },
  sandbox_snapshot: { verb: "Snapshotted the sandbox" },
  sandbox_restore: { verb: "Restored the sandbox" },
  skill_create: { verb: "Created a skill", argKeys: ["name", "slug"] },
  skill_invoke: { verb: "Used skill", argKeys: ["skillName", "name", "slug", "skill"] },
  skill_read_reference: { verb: "Read a skill reference", argKeys: ["path", "name"] },
};

function ToolGroup({ parts }: { parts: MessagePart[] }) {
  const rows = collapseToolRuns(parts);
  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <ToolRow key={row.key} parts={row.parts} />
      ))}
    </div>
  );
}

function collapseToolRuns(parts: MessagePart[]): { key: string; parts: MessagePart[] }[] {
  const rows: { key: string; parts: MessagePart[] }[] = [];
  let index = 0;
  while (index < parts.length) {
    const type = parts[index]?.type;
    let end = index + 1;
    while (end < parts.length && parts[end]?.type === type) {
      end += 1;
    }
    rows.push({ key: `${type}:${index}`, parts: parts.slice(index, end) });
    index = end;
  }
  return rows;
}

function ToolRow({ parts }: { parts: MessagePart[] }) {
  const [open, setOpen] = useState(false);
  const first = parts[0];
  if (!first) {
    return null;
  }
  const { verb, arg } = describeTool(first);
  const extra = parts.length - 1;

  return (
    <div className="cc-fade-in">
      <button
        className="group flex w-full items-center gap-1.5 text-left text-[#5f5f5f] text-[13px] transition-colors hover:text-[#1b1b1b]"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-3 w-3 shrink-0 text-[#c4c4c4] transition-transform group-hover:text-[#9b9b9b]",
            open ? "" : "-rotate-90",
          )}
        />
        <span className="shrink-0">{verb}</span>
        {arg ? (
          <code className="truncate rounded bg-[#f5f5f5] px-1.5 py-0.5 font-mono text-[#1b1b1b] text-[12px]">
            {arg}
          </code>
        ) : null}
        {extra > 0 ? <span className="shrink-0 text-[#9b9b9b]">(+{extra} more)</span> : null}
      </button>
      {open ? (
        <div className="mt-1.5 ml-[18px] space-y-1.5 border-[#ececec] border-l pl-3">
          {parts.map((part, partIndex) => (
            <pre
              className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[#707070] text-[11px]"
              // biome-ignore lint/suspicious/noArrayIndexKey: tool calls in a collapsed run have no stable id
              key={partIndex}
            >
              {toolPayload(part)}
            </pre>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function describeTool(part: MessagePart): { verb: string; arg: string | null } {
  const { name, input } = toolNameAndInput(part);
  const spec = TOOL_VERBS[name];
  const verb = spec?.verb ?? humanizeToolName(name);
  if (!spec?.argKeys) {
    return { verb, arg: null };
  }
  for (const key of spec.argKeys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return { verb, arg: shortenArg(value.trim()) };
    }
  }
  return { verb, arg: null };
}

function toolNameAndInput(part: MessagePart): {
  name: string;
  input: Record<string, unknown>;
} {
  const record = asRecord(part);
  if (part.type === "data-tool") {
    const data = asRecord(record["data"]);
    return { input: asRecord(data["input"]), name: stringRecordField(data, "toolName") };
  }
  if (part.type === "dynamic-tool") {
    return {
      input: asRecord(record["input"] ?? record["args"]),
      name: stringRecordField(record, "toolName"),
    };
  }
  return {
    input: asRecord(record["input"] ?? record["args"]),
    name: part.type.replace("tool-", ""),
  };
}

function humanizeToolName(name: string): string {
  if (!name) {
    return "Ran a tool";
  }
  const spaced = name.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function shortenArg(value: string): string {
  const collapsed = value.replace(/\s+/g, " ");
  if (collapsed.length <= MAX_TOOL_ARG_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_TOOL_ARG_LENGTH - 1)}…`;
}

// ---------------------------------------------------------------------------
// Deliverables — grouped artifact chips (bud parity)
// ---------------------------------------------------------------------------

function DeliverablesBlock({ items }: { items: ArtifactData[] }) {
  return (
    <div
      className="cc-fade-in rounded-[14px] border border-thread-border bg-[var(--thread-code-bg)] p-3"
      data-chat-deliverables="true"
    >
      <div className="mb-2 text-[10px] text-thread-text-muted uppercase tracking-[0.18em]">
        Deliverables
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <DeliverableChip data={item} key={item.outputId} />
        ))}
      </div>
    </div>
  );
}

function DeliverableChip({ data }: { data: ArtifactData }) {
  const Icon = deliverableIcon(data.kind, data.mimeType);
  const label = data.filename ?? artifactFallbackName(data);
  const isLink = data.kind === "link";
  const sizeLabel = typeof data.sizeBytes === "number" ? formatBytes(data.sizeBytes) : null;
  const meta = [data.kind, sizeLabel].filter(Boolean).join(" · ");

  return (
    <div className="flex items-center gap-2.5 rounded-[10px] border border-[#f1f1f1] bg-white px-2.5 py-2">
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[#585858]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[#1b1b1b] text-[13px]">{label}</div>
        <div className="text-[#9b9b9b] text-[11px]">{meta}</div>
      </div>
      <a
        className="inline-flex shrink-0 items-center gap-1.5 text-[#585858] text-[12px] transition-colors hover:text-[#1b1b1b]"
        href={data.downloadUrl}
        rel="noreferrer"
        target="_blank"
        {...(isLink ? {} : { download: true })}
      >
        {isLink ? (
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <Download aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {isLink ? "open" : "download"}
      </a>
    </div>
  );
}

function deliverableIcon(kind: ArtifactData["kind"], mimeType: string) {
  if (kind === "folder") {
    return Folder;
  }
  if (kind === "link") {
    return LinkIcon;
  }
  if (kind === "slide") {
    return Presentation;
  }
  if (kind === "xlsx") {
    return FileSpreadsheet;
  }
  if (kind === "image" || mimeType.startsWith("image/")) {
    return ImageIcon;
  }
  if (kind === "pdf" || kind === "docx") {
    return FileText;
  }
  if (mimeType.startsWith("text/") || mimeType.includes("json")) {
    return Code;
  }
  return FileText;
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

function TakeoverBlock({ data }: { data: TakeoverData }) {
  if (!data.available || !data.vncUrl) {
    return <DataBlock title="takeover" value="not available" />;
  }
  return (
    <div className="cc-fade-in rounded-[14px] border border-thread-border bg-[var(--thread-code-bg)] p-3 font-mono text-[11px] text-thread-text-secondary">
      <div className="mb-2 text-[10px] text-thread-text-muted">takeover</div>
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
  if (kind === "folder" || kind === "link") {
    return null;
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
          ? "cc-fade-in rounded-[14px] border border-[var(--thread-status-error-border)] bg-[var(--thread-status-error-bg)] p-3 font-mono text-[11px] text-red-700"
          : "cc-fade-in rounded-[14px] border border-thread-border bg-[var(--thread-code-bg)] p-3 font-mono text-[11px] text-thread-text-secondary"
      }
    >
      <div className="mb-2 text-[10px] text-thread-text-muted">{title}</div>
      <pre className="whitespace-pre-wrap break-words">{value}</pre>
    </div>
  );
}

function toolPayload(part: MessagePart): string {
  if (part.type === "data-tool") {
    return formatUnknown(summarizeToolValue(toolNameAndInput(part).input, 0));
  }
  const record = asRecord(part);
  const output = record["output"] ?? record["result"] ?? record["input"] ?? record;
  return formatUnknown(summarizeToolValue(output, 0));
}

function partKey(messageId: string, part: MessagePart, partIndex: number): string {
  if (part.type === "text") {
    return `${messageId}:${partIndex}:text:${part.text.slice(0, 80)}`;
  }
  // Stable key independent of streaming text so the collapsed reasoning row keeps its
  // expand state and does not re-fire its entrance fade on every delta.
  if (part.type === "data-thinking") {
    return `${messageId}:${partIndex}:thinking`;
  }
  if (part.type === "data-artifact") {
    return `${messageId}:${partIndex}:artifact:${part.data.outputId}`;
  }
  if (part.type === "data-seq") {
    return `${messageId}:${partIndex}:seq:${part.data.seq}`;
  }
  if (isToolPart(part)) {
    const record = asRecord(part);
    const source = part.type === "data-tool" ? asRecord(record["data"]) : record;
    const id =
      stringRecordField(source, "toolCallId") ||
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
