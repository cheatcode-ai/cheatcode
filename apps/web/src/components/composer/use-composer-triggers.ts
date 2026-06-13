"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useState,
} from "react";
import type { ComposerMenuItem } from "@/components/composer/composer-popover";
import { type CaretToken, replaceToken } from "@/lib/input/caret-tokens";

export type TriggerKind = "mention" | "slash";

export interface TriggerDetector {
  detect: (value: string, caret: number) => CaretToken | null;
  kind: TriggerKind;
}

interface UseComposerTriggersOptions {
  onChange: (value: string) => void;
  onInsert?: ((kind: TriggerKind, item: ComposerMenuItem) => void) | undefined;
  sources: readonly TriggerDetector[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
}

export interface ComposerTriggers {
  activeIndex: number;
  commitIndex: (index: number, items: readonly ComposerMenuItem[]) => void;
  dismiss: () => void;
  handleMenuKeyDown: (
    event: KeyboardEvent<HTMLTextAreaElement>,
    items: readonly ComposerMenuItem[],
  ) => boolean;
  isActive: boolean;
  kind: TriggerKind | null;
  onTextareaChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
  query: string;
  setActiveIndex: (index: number) => void;
}

function detectActive(
  value: string,
  caret: number,
  sources: readonly TriggerDetector[],
): { kind: TriggerKind; token: CaretToken } | null {
  for (const source of sources) {
    const token = source.detect(value, caret);
    if (token) {
      return { kind: source.kind, token };
    }
  }
  return null;
}

/**
 * Owns caret tracking, active-trigger detection (pure, derived in render),
 * keyboard navigation, and token replacement for both composer menus. Items are
 * supplied by the caller at event time (`handleMenuKeyDown`/`commitIndex` take the
 * current items array), which keeps the async `@` file source decoupled from this
 * hook with no shared mutable state.
 */
export function useComposerTriggers({
  onChange,
  onInsert,
  sources,
  textareaRef,
  value,
}: UseComposerTriggersOptions): ComposerTriggers {
  const [caret, setCaret] = useState(0);
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);

  const detected = detectActive(value, Math.min(caret, value.length), sources);
  const token = detected?.token ?? null;
  const kind = detected?.kind ?? null;
  const isActive = token !== null && dismissedStart !== token.start;

  useEffect(() => {
    if (pendingCaret === null) {
      return;
    }
    const element = textareaRef.current;
    element?.setSelectionRange(pendingCaret, pendingCaret);
    setPendingCaret(null);
  }, [pendingCaret, textareaRef]);

  function commitIndex(index: number, items: readonly ComposerMenuItem[]): void {
    const item = items[index];
    if (!token || !item || item.disabled) {
      return;
    }
    const next = replaceToken(value, token, item.insert);
    onChange(next.value);
    setCaret(next.caret);
    setPendingCaret(next.caret);
    setDismissedStart(null);
    setActiveIndex(0);
    onInsert?.(kind ?? "slash", item);
  }

  function handleMenuKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
    items: readonly ComposerMenuItem[],
  ): boolean {
    if (!isActive || items.length === 0) {
      return false;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % items.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + items.length) % items.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      commitIndex(Math.min(activeIndex, items.length - 1), items);
      return true;
    }
    if (event.key === "Escape" && token) {
      event.preventDefault();
      setDismissedStart(token.start);
      return true;
    }
    return false;
  }

  return {
    activeIndex,
    commitIndex,
    dismiss: () => {
      if (token) {
        setDismissedStart(token.start);
      }
    },
    handleMenuKeyDown,
    isActive,
    kind,
    onTextareaChange: (event) => {
      onChange(event.target.value);
      setCaret(event.target.selectionStart ?? event.target.value.length);
      setDismissedStart(null);
      setActiveIndex(0);
    },
    onTextareaSelect: (event) => {
      setCaret(event.currentTarget.selectionStart ?? 0);
    },
    query: token?.query ?? "",
    setActiveIndex,
  };
}
