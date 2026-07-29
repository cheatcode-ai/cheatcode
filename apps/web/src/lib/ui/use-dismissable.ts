"use client";

import type { RefObject } from "react";
import { useEffect } from "react";

interface UseDismissableOptions<T extends HTMLElement> {
  closeOnFocusOut?: boolean | undefined;
  isOpen: boolean;
  onDismiss: () => void;
  ref: RefObject<T | null>;
  triggerRef?: RefObject<HTMLElement | null> | undefined;
}

export function useDismissable<T extends HTMLElement>({
  closeOnFocusOut = false,
  isOpen,
  onDismiss,
  ref,
  triggerRef,
}: UseDismissableOptions<T>): void {
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const isOutside = (target: EventTarget | null) =>
      target instanceof Node &&
      !ref.current?.contains(target) &&
      !triggerRef?.current?.contains(target);
    const dismissOnPointer = (event: PointerEvent) => {
      if (isOutside(event.target)) {
        onDismiss();
      }
    };
    const dismissOnFocus = (event: FocusEvent) => {
      if (isOutside(event.target)) {
        onDismiss();
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      onDismiss();
      triggerRef?.current?.focus();
    };
    document.addEventListener("pointerdown", dismissOnPointer);
    document.addEventListener("keydown", dismissOnEscape);
    if (closeOnFocusOut) {
      document.addEventListener("focusin", dismissOnFocus);
    }
    return () => {
      document.removeEventListener("pointerdown", dismissOnPointer);
      document.removeEventListener("keydown", dismissOnEscape);
      if (closeOnFocusOut) {
        document.removeEventListener("focusin", dismissOnFocus);
      }
    };
  }, [closeOnFocusOut, isOpen, onDismiss, ref, triggerRef]);
}
