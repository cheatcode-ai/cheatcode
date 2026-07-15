"use client";

import { useId } from "react";
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
  label: string;
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
        "absolute bottom-full left-0 z-30 mb-2 flex max-h-72 w-80 max-w-[calc(100vw-2rem)] flex-col gap-1 overflow-y-auto rounded-[18px]",
        "border border-border bg-background p-1 shadow-[0_18px_70px_rgba(0,0,0,0.12)]",
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
      onClick={selectEnabledItem}
      onMouseDown={(event) => {
        event.preventDefault();
        selectEnabledItem();
      }}
      onMouseEnter={onHover}
      role="option"
      type="button"
    >
      <span className="font-mono text-[12px] tracking-wide">{item.label}</span>
      {item.hint ? (
        <span className="line-clamp-2 text-[11px] text-placeholder leading-snug">{item.hint}</span>
      ) : null}
    </button>
  );
}

function popoverRowClassName(isDisabled: boolean, isActive: boolean): string {
  return cn(
    "flex w-full flex-col items-start gap-0.5 rounded-[14px] px-2 py-1.5 text-left transition-colors",
    isDisabled
      ? "cursor-default text-placeholder"
      : isActive
        ? "bg-bg-secondary text-foreground"
        : "text-fg-secondary hover:bg-bg-secondary hover:text-foreground",
  );
}
