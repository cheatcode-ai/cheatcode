"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useState,
} from "react";
import type { ComposerMenuItem } from "@/components/composer/composer-popover";
import { type CaretToken, replaceToken } from "@/lib/input/caret-tokens";

type TriggerKind = "mention" | "slash";

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
 * current items array), which keeps the async project-file source decoupled from
 * this hook with no shared mutable state.
 */
export function useComposerTriggers({
  onChange,
  onInsert,
  sources,
  textareaRef,
  value,
}: UseComposerTriggersOptions): ComposerTriggers {
  const state = useTriggerState();
  const detected = detectActive(value, Math.min(state.caret, value.length), sources);
  const token = detected?.token ?? null;
  const kind = detected?.kind ?? null;
  const isActive = token !== null && state.dismissedStart !== token.start;
  const commitIndex = useTriggerCommit({
    kind,
    onChange,
    onInsert,
    state,
    textareaRef,
    token,
    value,
  });
  const handleMenuKeyDown = useTriggerMenuKeyDown({ commitIndex, isActive, state, token });
  return {
    activeIndex: state.activeIndex,
    commitIndex,
    dismiss: () => token && state.setDismissedStart(token.start),
    handleMenuKeyDown,
    isActive,
    kind,
    onTextareaChange: createTextareaChangeHandler(onChange, state),
    onTextareaSelect: (event) => state.setCaret(event.currentTarget.selectionStart ?? 0),
    query: token?.query ?? "",
    setActiveIndex: state.setActiveIndex,
  };
}

function useTriggerState() {
  const [caret, setCaret] = useState(0);
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  return { activeIndex, caret, dismissedStart, setActiveIndex, setCaret, setDismissedStart };
}

type TriggerState = ReturnType<typeof useTriggerState>;

function useTriggerCommit({
  kind,
  onChange,
  onInsert,
  state,
  textareaRef,
  token,
  value,
}: Omit<UseComposerTriggersOptions, "sources"> & {
  kind: TriggerKind | null;
  state: TriggerState;
  token: CaretToken | null;
}) {
  return useCallback(
    (index: number, items: readonly ComposerMenuItem[]) => {
      const item = items[index];
      if (!token || !item || item.disabled) return;
      const next = replaceToken(value, token, item.insert);
      onChange(next.value);
      state.setCaret(next.caret);
      state.setDismissedStart(null);
      state.setActiveIndex(0);
      onInsert?.(kind ?? "slash", item);
      restoreTextareaCaret(textareaRef, next.caret);
    },
    [kind, onChange, onInsert, state, textareaRef, token, value],
  );
}

function restoreTextareaCaret(textareaRef: RefObject<HTMLTextAreaElement | null>, caret: number) {
  window.requestAnimationFrame(() => {
    const element = textareaRef.current;
    element?.focus();
    element?.setSelectionRange(caret, caret);
  });
}

function useTriggerMenuKeyDown({
  commitIndex,
  isActive,
  state,
  token,
}: {
  commitIndex: ComposerTriggers["commitIndex"];
  isActive: boolean;
  state: TriggerState;
  token: CaretToken | null;
}): ComposerTriggers["handleMenuKeyDown"] {
  return useCallback(
    (event, items) => handleTriggerMenuKey(event, items, commitIndex, isActive, state, token),
    [commitIndex, isActive, state, token],
  );
}

function handleTriggerMenuKey(
  event: KeyboardEvent<HTMLTextAreaElement>,
  items: readonly ComposerMenuItem[],
  commitIndex: ComposerTriggers["commitIndex"],
  isActive: boolean,
  state: TriggerState,
  token: CaretToken | null,
): boolean {
  if (!isActive || items.length === 0) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    state.setActiveIndex((current) => (current + delta + items.length) % items.length);
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    commitIndex(Math.min(state.activeIndex, items.length - 1), items);
    return true;
  }
  if (event.key !== "Escape" || !token) return false;
  event.preventDefault();
  state.setDismissedStart(token.start);
  return true;
}

function createTextareaChangeHandler(onChange: (value: string) => void, state: TriggerState) {
  return (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value);
    state.setCaret(event.target.selectionStart ?? event.target.value.length);
    state.setDismissedStart(null);
    state.setActiveIndex(0);
  };
}
