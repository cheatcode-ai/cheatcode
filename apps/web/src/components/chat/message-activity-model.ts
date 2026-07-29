import type { CheatcodeUIMessage } from "@cheatcode/types";

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

export type MessagePart = CheatcodeUIMessage["parts"][number];
export type ToolPart = Extract<MessagePart, { type: "data-tool" }>;
export type ProjectCreatedPart = Extract<MessagePart, { type: "data-project-created" }>;
type TextPart = Extract<MessagePart, { type: "text" }>;
export type ActivityRow =
  | { kind: "tools"; key: string; parts: ToolPart[] }
  | { kind: "project-created"; key: string; part: ProjectCreatedPart }
  | { kind: "narration"; key: string; part: TextPart };
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
  research_deep: { verb: "Researched", argKeys: ["query", "topic"] },
  research_fanout: { verb: "Researched", argKeys: ["query", "topic"] },
  composio_execute: { verb: "Ran an app action", argKeys: ["tool", "action", "slug"] },
  composio_list_tools: { verb: "Listed app actions" },
  skill_create: { verb: "Created a skill", argKeys: ["name", "slug"] },
  skill_invoke: { verb: "Used skill", argKeys: ["skillName", "name", "slug", "skill"] },
  skill_read_reference: { verb: "Read a skill reference", argKeys: ["path", "name"] },
};

export function buildActivityRows(parts: MessagePart[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  let run: { parts: ToolPart[]; startIndex: number } | null = null;
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
    if (part.type === "data-project-created") {
      rows.push({ kind: "project-created", key: `project-created:${index}`, part });
      return;
    }
    if (part.type === "text") {
      rows.push({ kind: "narration", key: `narration:${index}`, part });
    }
  });
  flush();
  return rows;
}

export function collapseToolRuns(parts: ToolPart[]): { key: string; parts: ToolPart[] }[] {
  const rows: { key: string; parts: ToolPart[] }[] = [];
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

export function buildToolDetailSections(parts: ToolPart[]): ToolDetailSection[] {
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

export function describeTool(part: ToolPart): { verb: string; arg: string | null } {
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

function humanizeToolName(name: string): string {
  if (!name) {
    return "Ran a tool";
  }
  const spaced = name.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function isToolPart(part: MessagePart): part is ToolPart {
  return part.type === "data-tool";
}

function toolDetailSections(part: ToolPart): Array<Omit<ToolDetailSection, "key">> {
  const { name, input } = toolNameAndInput(part);
  const isCommand = isCommandTool(name);
  return [
    {
      label: isCommand ? "Command" : "Input",
      isCommand,
      scroll: false,
      value: isCommand ? commandValue(input) : formatUnknown(summarizeToolValue(input, 0)),
    },
  ].filter((section) => section.value.length > 0);
}

function toolPartIdentity(part: ToolPart): string {
  return `${part.type}:${part.data.toolCallId}`;
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

function toolNameAndInput(part: ToolPart): { input: Record<string, unknown>; name: string } {
  return {
    input: part.data.input ?? {},
    name: part.data.toolName,
  };
}

function shortenArg(value: string): string {
  const collapsed = value.replace(/\s+/g, " ");
  return collapsed.length <= MAX_TOOL_ARG_LENGTH
    ? collapsed
    : `${collapsed.slice(0, MAX_TOOL_ARG_LENGTH - 1)}…`;
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
