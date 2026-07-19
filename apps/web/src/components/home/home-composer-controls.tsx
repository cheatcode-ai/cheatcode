"use client";

import { Puzzle, X } from "@cheatcode/ui";
import {
  type ComposerIntent,
  type IntentId,
  QUICK_ACTION_PRIMARY_INTENTS,
  QUICK_ACTION_SECONDARY_INTENTS,
} from "@/components/home/home-composer-intents";
import { cn } from "@/lib/ui/cn";

const SKILL_CREATOR_SUGGESTIONS = [
  "Create a skill that drafts follow-up emails from meeting notes",
  "Create a skill that summarizes Linear issues",
  "Create a skill that turns screenshots into bug reports",
  "Create a skill that researches a company before sales calls",
] as const;

export function SkillCreatorSuggestions({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mx-auto w-full max-w-[448px] overflow-hidden rounded-[17px] border border-border bg-secondary/60">
      <div className="px-3 py-1.5 font-medium text-[11px] text-muted-foreground">Create skills</div>
      <ul className="flex flex-col rounded-[16px] bg-background p-1">
        {SKILL_CREATOR_SUGGESTIONS.map((suggestion) => (
          <li key={suggestion}>
            <button
              className="flex w-full cursor-pointer items-start justify-between rounded-full px-2.5 py-1.5 hover:bg-secondary"
              onClick={() => onPick(suggestion)}
              type="button"
            >
              <span className="flex min-w-0 items-start gap-2.5">
                <Puzzle
                  aria-hidden="true"
                  className="mt-0.75 size-3 shrink-0 text-muted-foreground"
                  strokeWidth={2.25}
                />
                <span className="min-w-0 text-left text-[13px] text-foreground leading-snug">
                  {suggestion}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HomeQuickActions({
  activeIntentId,
  onIntentClick,
}: {
  activeIntentId: IntentId | null;
  onIntentClick: (intentId: IntentId) => void;
}) {
  return (
    <div className="paper-soft-panel mx-auto flex w-full max-w-[448px] flex-col gap-1 overflow-hidden rounded-[17px] p-1">
      <div className="grid w-full grid-cols-2 gap-1">
        {QUICK_ACTION_PRIMARY_INTENTS.map((intent) => (
          <HomeQuickAction
            active={activeIntentId === intent.id}
            icon={intent.icon}
            key={intent.id}
            label={intent.label}
            onClick={() => onIntentClick(intent.id)}
          />
        ))}
      </div>
      <div className="grid w-full grid-cols-3 gap-1">
        {QUICK_ACTION_SECONDARY_INTENTS.map((intent) => (
          <HomeQuickAction
            active={activeIntentId === intent.id}
            icon={intent.icon}
            key={intent.id}
            label={intent.label}
            onClick={() => onIntentClick(intent.id)}
          />
        ))}
      </div>
    </div>
  );
}

function HomeQuickAction({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ComposerIntent["icon"];
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active ? true : undefined}
      className={cn(
        "cheatcode-lifted-surface flex h-8 min-w-0 items-center justify-center gap-1 rounded-full px-1.5 font-medium text-[12px] text-foreground leading-[18px] transition-colors hover:bg-secondary sm:gap-1.5 sm:px-2 sm:text-[13px] sm:leading-[19.5px]",
        active ? "bg-secondary shadow-[inset_0_0_0_1px_rgba(27,27,27,0.04)]" : null,
      )}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-fg-secondary" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

export function RemovableChip({
  label,
  onClear,
  title,
}: {
  label: string;
  onClear: () => void;
  title?: string | undefined;
}) {
  return (
    <div
      className="flex h-8 items-center gap-2 rounded-full border border-border bg-background px-3 text-[12px] text-foreground"
      title={title}
    >
      <span className="max-w-40 truncate">{label}</span>
      <button
        aria-label={`Remove ${label}`}
        className="-mr-1.5 ml-0.5 flex h-6 w-6 items-center justify-center text-placeholder transition-colors hover:text-foreground"
        onClick={onClear}
        type="button"
      >
        <X aria-hidden="true" className="h-3 w-3" />
      </button>
    </div>
  );
}
