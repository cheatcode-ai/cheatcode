"use client";

import type { IntegrationName } from "@cheatcode/types";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { Link as LinkIcon, X } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

// Curated display names for the most common toolkits. Any other connected toolkit
// slug falls back to a prettified label via toolLabel().
const TOOL_LABELS: Record<string, string> = {
  github: "GitHub",
  gmail: "Gmail",
  linear: "Linear",
  notion: "Notion",
  slack: "Slack",
};

function toolLabel(slug: string): string {
  return (
    TOOL_LABELS[slug] ??
    slug
      .split("_")
      .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
      .join(" ")
  );
}

export function composePromptWithComposerContext({
  prompt,
  skill,
  tool,
}: {
  prompt: string;
  skill: string | null;
  tool: IntegrationName | null;
}): string {
  const trimmed = prompt.trim();
  let nextPrompt = skill && !trimmed.startsWith("/") ? `/${skill} ${trimmed}` : trimmed;
  if (tool) {
    nextPrompt = [
      `Selected tool: ${toolLabel(tool)} (${tool}). Use the Composio integration for this request when an external app action is needed.`,
      nextPrompt,
    ].join("\n\n");
  }
  return nextPrompt.trim();
}

export function ComposerContextChips({
  className,
  onClearSkill,
  onClearTool,
  skill,
  tool,
}: {
  className?: string | undefined;
  onClearSkill?: (() => void) | undefined;
  onClearTool?: (() => void) | undefined;
  skill: string | null;
  tool: IntegrationName | null;
}) {
  if (!skill && !tool) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {skill ? (
        <ComposerContextChip label={skill} onClear={onClearSkill} tone="skill" typeLabel="Skill" />
      ) : null}
      {tool ? (
        <ComposerContextChip
          label={toolLabel(tool)}
          onClear={onClearTool}
          tone="tool"
          typeLabel="Tool"
        />
      ) : null}
    </div>
  );
}

function ComposerContextChip({
  label,
  onClear,
  tone,
  typeLabel,
}: {
  label: string;
  onClear?: (() => void) | undefined;
  tone: "skill" | "tool";
  typeLabel: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-border bg-background px-2.5 pr-1.5",
        "font-medium text-[13px] text-foreground leading-none shadow-[0_1px_2px_rgba(0,0,0,0.03)]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full",
          tone === "skill"
            ? "bg-[linear-gradient(135deg,#2e7cff,#67d7ff)] text-white"
            : "bg-secondary text-fg-secondary",
        )}
      >
        {tone === "skill" ? (
          <CheatcodeMark className="h-3 w-3" />
        ) : (
          <LinkIcon className="h-3 w-3" />
        )}
      </span>
      <span className="sr-only">{typeLabel}: </span>
      <span className="min-w-0 truncate">{label}</span>
      {onClear ? (
        <button
          aria-label={`Remove ${typeLabel.toLowerCase()} ${label}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-placeholder transition-colors hover:bg-secondary hover:text-foreground"
          onClick={onClear}
          type="button"
        >
          <X aria-hidden="true" className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
