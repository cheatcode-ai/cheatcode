"use client";

import type { IntegrationName } from "@cheatcode/types";
import { FileArchive, FileText, Folder } from "@cheatcode/ui";
import { useId } from "react";
import { IntegrationBrandLogo } from "@/components/skills/integration-brand-logo";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { cn } from "@/lib/ui/cn";

/**
 * A single selectable row. `insert` is the text the trigger hook substitutes for
 * the active token on commit; `disabled` rows (e.g. transient fetch errors) are
 * shown but never selectable.
 */
export interface ComposerMenuItem {
  disabled?: boolean | undefined;
  hint?: string | undefined;
  id: string;
  insert: string;
  integrationName?: IntegrationName | undefined;
  label: string;
  skillName?: string | undefined;
  visual: "archive" | "directory" | "file" | "integration" | "status" | "user-skill";
}

interface ComposerPopoverProps {
  activeIndex: number;
  ariaLabel: string;
  items: readonly ComposerMenuItem[];
  onHoverIndex: (index: number) => void;
  onSelectIndex: (index: number) => void;
}

/**
 * Presentational listbox anchored above the composer. Styling mirrors the
 * composer's other floating control menus. Keyboard navigation/selection is owned by
 * `useComposerTriggers`; this component only renders rows and forwards
 * hover/click intent. `onMouseDown` is used (not `onClick`) with
 * `preventDefault` so committing a row never blurs the textarea.
 */
export function ComposerPopover({
  activeIndex,
  ariaLabel,
  items,
  onHoverIndex,
  onSelectIndex,
}: ComposerPopoverProps) {
  const baseId = useId();
  if (items.length === 0) {
    return null;
  }
  const safeIndex = Math.min(activeIndex, items.length - 1);
  return (
    <div
      aria-activedescendant={`${baseId}-${safeIndex}`}
      aria-label={ariaLabel}
      className={cn(
        "absolute bottom-full left-0 z-50 mb-2 flex max-h-[234px] w-[320px] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-lg",
        "fade-in-0 zoom-in-95 animate-in border border-border bg-popover p-1 shadow-lg duration-150",
      )}
      role="listbox"
      tabIndex={-1}
    >
      {items.map((item, index) => (
        <ComposerPopoverRow
          id={`${baseId}-${index}`}
          isActive={index === safeIndex}
          item={item}
          key={item.id}
          onHover={() => onHoverIndex(index)}
          onSelect={() => onSelectIndex(index)}
        />
      ))}
    </div>
  );
}

function ComposerPopoverRow({
  id,
  isActive,
  item,
  onHover,
  onSelect,
}: {
  id: string;
  isActive: boolean;
  item: ComposerMenuItem;
  onHover: () => void;
  onSelect: () => void;
}) {
  const selectEnabledItem = () => {
    if (!item.disabled) onSelect();
  };
  return (
    <button
      aria-selected={isActive}
      className={popoverRowClassName(item.disabled === true, isActive)}
      disabled={item.disabled}
      id={id}
      onMouseDown={(event) => {
        event.preventDefault();
        selectEnabledItem();
      }}
      onMouseEnter={onHover}
      role="option"
      type="button"
    >
      <ComposerMenuIcon item={item} />
      <span className="truncate font-medium text-foreground text-xs">{item.label}</span>
    </button>
  );
}

function ComposerMenuIcon({ item }: { item: ComposerMenuItem }) {
  if (item.visual === "integration" && item.integrationName) {
    return (
      <IntegrationBrandLogo displayName={item.label} size="menu" slug={item.integrationName} />
    );
  }
  if (item.visual === "user-skill") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center text-primary">
        <CheatcodeMark aria-hidden="true" className="size-4" />
      </span>
    );
  }
  if (item.visual === "directory") {
    return (
      <Folder aria-hidden="true" className="size-4 shrink-0 text-primary" strokeWidth={2.25} />
    );
  }
  if (item.visual === "archive") {
    return (
      <FileArchive aria-hidden="true" className="size-4 shrink-0 text-primary" strokeWidth={2.25} />
    );
  }
  if (item.visual === "file") {
    return (
      <FileText
        aria-hidden="true"
        className="size-4 shrink-0 text-placeholder"
        strokeWidth={2.25}
      />
    );
  }
  return <span aria-hidden="true" className="size-4 shrink-0" />;
}

function popoverRowClassName(isDisabled: boolean, isActive: boolean): string {
  return cn(
    "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors duration-100",
    isDisabled
      ? "cursor-default text-placeholder"
      : isActive
        ? "cursor-pointer bg-accent-foreground/10"
        : "cursor-pointer hover:bg-accent-foreground/5",
  );
}
