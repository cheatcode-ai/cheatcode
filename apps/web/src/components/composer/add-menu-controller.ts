"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

interface AddMenuController {
  actions: {
    close: () => void;
    toggle: () => void;
  };
  meta: {
    menuRef: RefObject<HTMLDivElement | null>;
    triggerRef: RefObject<HTMLButtonElement | null>;
  };
  state: { isOpen: boolean };
}

export function useAddMenuController(): AddMenuController {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  useDismissableMenu({ close, isOpen, menuRef, triggerRef });
  return {
    actions: { close, toggle: () => setIsOpen((current) => !current) },
    meta: { menuRef, triggerRef },
    state: { isOpen },
  };
}

function useDismissableMenu({
  close,
  isOpen,
  menuRef,
  triggerRef,
}: {
  close: () => void;
  isOpen: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [close, isOpen, menuRef, triggerRef]);
}
