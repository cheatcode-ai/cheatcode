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

/**
 * Presentational listbox anchored above the composer. Styling mirrors the
 * existing `BudgetCapMenu` idiom. Keyboard navigation/selection is owned by
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
}: {
  activeIndex: number;
  ariaLabel: string;
  items: readonly ComposerMenuItem[];
  onHoverIndex: (index: number) => void;
  onSelectIndex: (index: number) => void;
}) {
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
        "border border-[#f1f1f1] bg-white p-1 shadow-[0_18px_70px_rgba(0,0,0,0.12)]",
      )}
      role="listbox"
      tabIndex={-1}
    >
      {items.map((item, index) => (
        <button
          aria-selected={index === safeIndex}
          className={cn(
            "flex w-full flex-col items-start gap-0.5 rounded-[14px] px-2 py-1.5 text-left transition-colors",
            item.disabled
              ? "cursor-default text-[#b5b5b5]"
              : index === safeIndex
                ? "bg-[#f8f8f8] text-[#1b1b1b]"
                : "text-[#707070] hover:bg-[#fafafa] hover:text-[#1b1b1b]",
          )}
          disabled={item.disabled}
          id={`${baseId}-${index}`}
          key={item.id}
          onMouseDown={(event) => {
            event.preventDefault();
            if (!item.disabled) {
              onSelectIndex(index);
            }
          }}
          onClick={() => {
            if (!item.disabled) {
              onSelectIndex(index);
            }
          }}
          onMouseEnter={() => onHoverIndex(index)}
          role="option"
          type="button"
        >
          <span className="font-mono text-[12px] tracking-wide">{item.label}</span>
          {item.hint ? (
            <span className="line-clamp-2 text-[#8a8a8a] text-[11px] leading-snug">
              {item.hint}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
