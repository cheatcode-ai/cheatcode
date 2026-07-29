"use client";

import { type RefObject, useCallback, useRef, useState } from "react";
import { useDismissable } from "@/lib/ui/use-dismissable";

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
  useDismissable({ isOpen, onDismiss: close, ref: menuRef, triggerRef });
  return {
    actions: { close, toggle: () => setIsOpen((current) => !current) },
    meta: { menuRef, triggerRef },
    state: { isOpen },
  };
}
