"use client";

import { useState } from "react";
import { Response as MarkdownResponse } from "@/components/ai-elements/response";
import {
  type ActivityItem,
  buildActivityRows,
  buildToolDetailSections,
  collapseToolRuns,
  describeTool,
  isToolPart,
  type MessagePart,
  type ProjectCreatedPart,
  type ToolPart,
} from "@/components/chat/message-activity-model";
import { ChevronDown } from "@/components/ui";
import { cn } from "@/lib/ui/cn";

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

function ActivityTimeline({ rows }: { rows: ActivityItem[] }) {
  return (
    <div className="relative ml-[5px] pt-1.5 pl-5">
      {rows.map((row) => (
        <div className="relative pt-[5px] pb-2 pl-1 last:pb-0" key={row.key}>
          <TimelineConnector continued />
          {row.kind === "tools" ? <ToolGroup parts={row.parts} /> : null}
          {row.kind === "project-created" ? <ProjectCreatedActivity part={row.part} /> : null}
          {row.kind === "narration" ? <ActivityNarration text={row.part.text} /> : null}
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
    <div className="max-w-none text-[14px] text-fg-secondary leading-5">
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

export function ProjectCreatedActivity({ part }: { part: ProjectCreatedPart }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cc-fade-in flex w-full min-w-0 flex-col">
      <button
        aria-expanded={open}
        className="group flex h-5 w-full min-w-0 items-center gap-1.5 text-left text-[14px] text-fg-secondary transition-colors duration-200 hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate">Created project {part.data.projectName}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-3 w-3 shrink-0 text-placeholder transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open ? (
        <div className="relative mt-0 ml-[5px] pt-1.5 pl-5">
          <ToolDetailCard
            continued={false}
            isCommand={false}
            label="Project"
            scroll={false}
            value={part.data.projectName}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ToolGroup({ parts }: { parts: ToolPart[] }) {
  const rows = collapseToolRuns(parts);
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <ToolRow key={row.key} parts={row.parts} />
      ))}
    </div>
  );
}

function ToolRow({ parts }: { parts: ToolPart[] }) {
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

function ToolDetails({ parts }: { parts: ToolPart[] }) {
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
