"use client";

import type { CheatcodeUIMessage } from "@cheatcode/types";
import { useState } from "react";
import { Response as MarkdownResponse } from "@/components/ai-elements/response";
import { ChevronDown, Loader2 } from "@/components/ui/icons";
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
type ThinkingData = Extract<MessagePart, { type: "data-thinking" }>["data"];
type ActivityRow =
  | { kind: "tools"; key: string; parts: MessagePart[] }
  | { kind: "part"; key: string; part: MessagePart };
type ToolVerbSpec = { verb: string; argKeys?: string[] };
type ToolDetailSection = {
  isCommand: boolean;
  key: string;
  label: string;
  scroll: boolean;
  value: string;
};

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
  skill_create: { verb: "Created a skill", argKeys: ["name", "slug"] },
  skill_invoke: { verb: "Used skill", argKeys: ["skillName", "name", "slug", "skill"] },
  skill_read_reference: { verb: "Read a skill reference", argKeys: ["path", "name"] },
};

export function ActivityDisclosure({
  parts,
  streaming,
}: {
  parts: MessagePart[];
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isOpen = open || streaming;
  const toolCount = parts.filter(isToolPart).length;
  const rows = buildActivityRows(parts);

  return (
    <div className="cc-fade-in">
      {streaming ? null : (
        <button
          aria-expanded={isOpen}
          className="group flex h-5 w-full items-center gap-1 text-left text-[14px] text-fg-secondary transition-colors duration-200 hover:text-foreground"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <span className="whitespace-nowrap">{activityLabel(rows.length, toolCount)}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn("h-3 w-3 text-placeholder transition-transform", !isOpen && "-rotate-90")}
          />
        </button>
      )}
      {isOpen ? <ActivityTimeline rows={rows} /> : null}
    </div>
  );
}

function ActivityTimeline({ rows }: { rows: ActivityRow[] }) {
  return (
    <div className="relative ml-[5px] pt-1.5 pl-5">
      {rows.map((row) => (
        <div className="relative pt-[5px] pb-2 pl-1 last:pb-0" key={row.key}>
          <TimelineConnector continued />
          {row.kind === "tools" ? (
            <ToolGroup parts={row.parts} />
          ) : row.part.type === "data-thinking" ? (
            <ThinkingBlock data={row.part.data} />
          ) : (
            <ActivityNarration text={(row.part as { text: string }).text} />
          )}
        </div>
      ))}
    </div>
  );
}

function ActivityNarration({ text }: { text: string }) {
  if (text.trim().length === 0) {
    return null;
  }
  return (
    <div className="chat-markdown max-w-none text-[14px] text-fg-secondary leading-5">
      <MarkdownResponse>{text}</MarkdownResponse>
    </div>
  );
}

function activityLabel(stepCount: number, toolCount: number): string {
  if (toolCount > 0) {
    return `Called ${toolCount} tool${toolCount === 1 ? "" : "s"}`;
  }
  return `Worked through ${stepCount} step${stepCount === 1 ? "" : "s"}`;
}

function buildActivityRows(parts: MessagePart[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  let run: { parts: MessagePart[]; startIndex: number } | null = null;
  const flush = () => {
    if (run) {
      rows.push({ kind: "tools", key: `tools:${run.startIndex}`, parts: run.parts });
      run = null;
    }
  };
  parts.forEach((part, index) => {
    if (isToolPart(part)) {
      run ??= { parts: [], startIndex: index };
      run.parts.push(part);
      return;
    }
    flush();
    rows.push({ kind: "part", key: `step:${index}`, part });
  });
  flush();
  return rows;
}

export function ThinkingBlock({ data }: { data: ThinkingData }) {
  const [open, setOpen] = useState(false);
  const streaming = data.delta;
  const label = thinkingLabel(data);
  const canExpand = !streaming && data.text.trim().length > 0;

  return (
    <div className="cc-fade-in flex w-full flex-col text-[14px]">
      <button
        aria-expanded={canExpand ? open : undefined}
        className="group flex h-5 w-full items-center gap-1 text-fg-secondary transition-colors duration-200 hover:text-foreground disabled:cursor-default"
        disabled={!canExpand}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {streaming ? <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> : null}
        <span className="whitespace-nowrap">{label}</span>
        {canExpand ? (
          <ChevronDown
            aria-hidden="true"
            className={cn("h-3 w-3 text-placeholder transition-transform", !open && "-rotate-90")}
          />
        ) : null}
      </button>
      {open && canExpand ? (
        <div className="mt-1.5 ml-[5px] whitespace-pre-wrap border-border border-l pl-5 text-fg-secondary leading-5">
          {data.text}
        </div>
      ) : null}
    </div>
  );
}

function thinkingLabel(data: ThinkingData): string {
  if (data.delta) {
    return "Thinking…";
  }
  if (typeof data.durationMs === "number") {
    return `Thought for ${formatThinkingDuration(data.durationMs)}`;
  }
  return "Thought";
}

function formatThinkingDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(seconds === 0 ? 0 : 1)}s`;
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

export function ToolGroup({ parts }: { parts: MessagePart[] }) {
  const rows = collapseToolRuns(parts);
  return (
    <div className="space-y-2">
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
  const description = describeTool(first);
  const extra = parts.length - 1;
  return (
    <div className="cc-fade-in flex w-full min-w-0 flex-col">
      <button
        aria-expanded={open}
        className="group flex h-5 w-full min-w-0 items-center gap-1.5 text-left text-[14px] text-fg-secondary transition-colors duration-200 hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate">{toolRowLabel(description, extra)}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-3 w-3 shrink-0 text-placeholder transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open ? <ToolDetails parts={parts} /> : null}
    </div>
  );
}

function toolRowLabel(description: { arg: string | null; verb: string }, extra: number): string {
  const primary = description.arg ? `${description.verb} ${description.arg}` : description.verb;
  return extra > 0 ? `${primary} (+${extra} more)` : primary;
}

function ToolDetails({ parts }: { parts: MessagePart[] }) {
  const sections = buildToolDetailSections(parts);
  return (
    <div className="relative mt-0 ml-[5px] space-y-0 pt-1.5 pl-5">
      {sections.map((section, index) => (
        <ToolDetailCard
          continued={index < sections.length - 1}
          isCommand={section.isCommand}
          key={section.key}
          label={section.label}
          scroll={section.scroll}
          value={section.value}
        />
      ))}
    </div>
  );
}

function buildToolDetailSections(parts: MessagePart[]): ToolDetailSection[] {
  const occurrences = new Map<string, number>();
  return parts.flatMap((part) => {
    const partIdentity = toolPartIdentity(part);
    return toolDetailSections(part).map((section) => {
      const baseKey = `${partIdentity}:${section.label}`;
      const occurrence = occurrences.get(baseKey) ?? 0;
      occurrences.set(baseKey, occurrence + 1);
      return {
        ...section,
        key: occurrence === 0 ? baseKey : `${baseKey}:${occurrence}`,
      };
    });
  });
}

function ToolDetailCard({
  continued,
  isCommand,
  label,
  scroll,
  value,
}: {
  continued: boolean;
  isCommand: boolean;
  label: string;
  scroll: boolean;
  value: string;
}) {
  return (
    <div className="relative pb-2 first:pt-1 last:pb-0">
      <TimelineConnector continued={continued} />
      <div className="overflow-hidden rounded-[20px] border-2 border-border bg-background dark:border-[#252525] dark:bg-[#151515]">
        <div className="bg-background p-0.5 dark:bg-[#151515]">
          <div
            className={cn(
              "min-w-0 overflow-hidden rounded-[16px] bg-gradient-to-b from-bg-secondary to-transparent p-0.5 pt-2 dark:from-[#1b1b1b]",
              scroll && "max-h-[300px] overflow-y-auto",
            )}
          >
            <div className="mb-1.5 px-2.5 text-[10px] text-fg-secondary uppercase">{label}</div>
            <pre
              className={cn(
                "whitespace-pre-wrap break-all rounded-[16px] bg-background p-2.5 font-mono text-[13px] text-foreground leading-[19.5px] dark:bg-[#111111]",
                isCommand && "dark:text-[#b8d493]",
              )}
            >
              {isCommand ? <ShellCommand value={value} /> : value}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineConnector({ continued }: { continued: boolean }) {
  return (
    <>
      {continued ? (
        <span
          aria-hidden="true"
          className="absolute top-2 bottom-0 -left-5 w-[1.5px] bg-border-tree"
        />
      ) : null}
      <span
        aria-hidden="true"
        className="absolute top-0 -left-5 h-4 w-4 rounded-bl-lg border-border-tree border-b-[1.5px] border-l-[1.5px]"
      />
    </>
  );
}

function toolDetailSections(part: MessagePart): Array<Omit<ToolDetailSection, "key">> {
  const record = asRecord(part);
  const { name, input } = toolNameAndInput(part);
  const output = record["output"] ?? record["result"];
  const isCommand = isCommandTool(name);
  const sections = [
    {
      label: isCommand ? "Command" : "Input",
      isCommand,
      scroll: false,
      value: isCommand ? commandValue(input) : formatUnknown(summarizeToolValue(input, 0)),
    },
  ];
  if (output !== undefined) {
    sections.push({
      label: "Output",
      isCommand: false,
      scroll: true,
      value: formatUnknown(summarizeToolValue(output, 0)),
    });
  }
  return sections.filter((section) => section.value.length > 0);
}

function toolPartIdentity(part: MessagePart): string {
  const record = asRecord(part);
  const data = part.type === "data-tool" ? asRecord(record["data"]) : record;
  const callId =
    stringRecordField(data, "toolCallId") ||
    stringRecordField(record, "toolCallId") ||
    stringRecordField(record, "id");
  if (callId) {
    return `${part.type}:${callId}`;
  }
  const { input, name } = toolNameAndInput(part);
  const output = record["output"] ?? record["result"];
  return `${part.type}:${name}:${toolValueFingerprint([input, output])}`;
}

function toolValueFingerprint(value: unknown): string {
  const serialized = formatUnknown(summarizeToolValue(value, 0));
  let hash = 2_166_136_261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash = Math.imul(hash ^ serialized.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function ShellCommand({ value }: { value: string }) {
  const quoteIndex = firstQuoteIndex(value);
  if (quoteIndex < 0) {
    return <span className="text-foreground">{value}</span>;
  }
  return (
    <>
      <span className="text-foreground">{value.slice(0, quoteIndex)}</span>
      <span>{value.slice(quoteIndex)}</span>
    </>
  );
}

function firstQuoteIndex(value: string): number {
  const single = value.indexOf("'");
  const double = value.indexOf('"');
  if (single < 0) return double;
  if (double < 0) return single;
  return Math.min(single, double);
}

function commandValue(input: Record<string, unknown>): string {
  for (const key of ["command", "cmd", "code"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return formatUnknown(summarizeToolValue(input, 0));
}

function isCommandTool(name: string): boolean {
  return name === "runCode" || name.startsWith("shell_") || name === "start_dev_server";
}

function describeTool(part: MessagePart): { verb: string; arg: string | null } {
  const { name, input } = toolNameAndInput(part);
  const spec = TOOL_VERBS[name];
  const verb = spec?.verb ?? humanizeToolName(name);
  for (const key of spec?.argKeys ?? []) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return { verb, arg: shortenArg(value.trim()) };
    }
  }
  return { verb, arg: null };
}

function toolNameAndInput(part: MessagePart): { input: Record<string, unknown>; name: string } {
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
  return collapsed.length <= MAX_TOOL_ARG_LENGTH
    ? collapsed
    : `${collapsed.slice(0, MAX_TOOL_ARG_LENGTH - 1)}…`;
}

export function isToolPart(part: MessagePart): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool" || part.type === "data-tool";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringRecordField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
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
    return summarizeToolArray(value, depth);
  }
  return summarizeToolRecord(asRecord(value), depth);
}

function summarizeToolArray(value: unknown[], depth: number): unknown[] {
  const visible = value
    .slice(0, MAX_TOOL_ARRAY_ITEMS)
    .map((item) => summarizeToolValue(item, depth + 1));
  return value.length > MAX_TOOL_ARRAY_ITEMS
    ? [...visible, `[${value.length - MAX_TOOL_ARRAY_ITEMS} more item(s)]`]
    : visible;
}

function summarizeToolRecord(
  value: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  const entries = Object.entries(value);
  const summarized: Record<string, unknown> = {};
  for (const [key, entryValue] of entries.slice(0, MAX_TOOL_OBJECT_KEYS)) {
    summarized[key] =
      typeof entryValue === "string" && LARGE_TOOL_FIELDS.has(key)
        ? summarizeLargeField(key, entryValue)
        : summarizeToolValue(entryValue, depth + 1);
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
