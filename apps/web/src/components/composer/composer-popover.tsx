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
        "absolute bottom-full left-0 z-30 mb-2 max-h-72 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto",
        "border border-white/10 bg-[#09090b] p-1 shadow-2xl",
      )}
      role="listbox"
      tabIndex={-1}
    >
      {items.map((item, index) => (
        <button
          aria-selected={index === safeIndex}
          className={cn(
            "flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left transition-colors",
            item.disabled
              ? "cursor-default text-zinc-600"
              : index === safeIndex
                ? "bg-white/10 text-white"
                : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
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
          onMouseEnter={() => onHoverIndex(index)}
          role="option"
          type="button"
        >
          <span className="font-mono text-[12px] tracking-wide">{item.label}</span>
          {item.hint ? (
            <span className="line-clamp-2 text-[11px] text-zinc-500 leading-snug">{item.hint}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
