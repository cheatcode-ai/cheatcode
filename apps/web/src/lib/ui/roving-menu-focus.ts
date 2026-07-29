import type { FocusEvent, KeyboardEvent, RefObject } from "react";

export function rovingMenuItems(
  container: HTMLElement | null,
  selector: string,
): HTMLButtonElement[] {
  return container ? Array.from(container.querySelectorAll<HTMLButtonElement>(selector)) : [];
}

export function handleRovingMenuFocus(event: FocusEvent<HTMLDivElement>, selector: string): void {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const items = rovingMenuItems(event.currentTarget, selector);
  const focusedIndex = items.indexOf(target);
  if (focusedIndex >= 0) {
    setRovingMenuTabStop(items, focusedIndex, false);
  }
}

export function resetRovingMenuTabStop(
  ref: RefObject<HTMLDivElement | null>,
  selector: string,
): void {
  setRovingMenuTabStop(rovingMenuItems(ref.current, selector), 0, false);
}

export function moveRovingMenuFocus(event: KeyboardEvent<HTMLElement>, selector: string): boolean {
  const items = rovingMenuItems(event.currentTarget, selector);
  if (items.length === 0 || !["ArrowDown", "ArrowUp", "End", "Home"].includes(event.key)) {
    return false;
  }
  const currentIndex = items.indexOf(event.target as HTMLButtonElement);
  const lastIndex = items.length - 1;
  const nextIndex = menuMoveIndex(event.key, currentIndex, lastIndex);
  event.preventDefault();
  event.stopPropagation();
  setRovingMenuTabStop(items, nextIndex, true);
  return true;
}

export function setRovingMenuTabStop(
  items: readonly HTMLButtonElement[],
  activeIndex: number,
  shouldFocus: boolean,
): void {
  for (const [index, item] of items.entries()) {
    item.tabIndex = index === activeIndex ? 0 : -1;
  }
  if (shouldFocus) {
    items[activeIndex]?.focus();
  }
}

function menuMoveIndex(key: string, currentIndex: number, lastIndex: number): number {
  if (key === "Home" || (key === "ArrowDown" && currentIndex === lastIndex)) {
    return 0;
  }
  if (key === "End" || (key === "ArrowUp" && currentIndex <= 0)) {
    return lastIndex;
  }
  return key === "ArrowDown" ? currentIndex + 1 : currentIndex - 1;
}
