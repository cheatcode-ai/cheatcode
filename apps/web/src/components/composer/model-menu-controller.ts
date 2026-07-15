"use client";

import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { type AgentModelId, agentModelOption } from "@/components/composer/model-menu-model";
import type { AgentModelOption } from "@/lib/agent-models";
import { useProfileQuery } from "@/lib/hooks/use-profile";
import { useAppStore } from "@/lib/store/app-store";

export interface ModelMenuController {
  actions: {
    close: () => void;
    select: (id: AgentModelId) => void;
    toggle: () => void;
  };
  meta: {
    menuId: string;
    menuRef: RefObject<HTMLDivElement | null>;
  };
  state: {
    activeOption: AgentModelOption;
    disabledModels: readonly string[];
    isOpen: boolean;
    shouldRender: boolean;
  };
}

export function useModelMenuController({
  onOpenChange,
  open,
}: {
  onOpenChange?: ((open: boolean) => void) | undefined;
  open?: boolean | undefined;
}): ModelMenuController {
  const agentModelId = useAppStore((state) => state.agentModelId);
  const setAgentModelId = useAppStore((state) => state.setAgentModelId);
  const disabledModels = useProfileQuery().data?.disabledModels ?? [];
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `model-menu-${useId()}`;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;
  const shouldRender = useMenuPresence(isOpen);
  useDismissModelMenu({ isOpen, menuRef, setIsOpen });
  return {
    actions: {
      close: () => setIsOpen(false),
      select: (id) => {
        setAgentModelId(id);
        setIsOpen(false);
      },
      toggle: () => setIsOpen(!isOpen),
    },
    meta: { menuId, menuRef },
    state: { activeOption: agentModelOption(agentModelId), disabledModels, isOpen, shouldRender },
  };
}

function useMenuPresence(isOpen: boolean): boolean {
  const [shouldRender, setShouldRender] = useState(isOpen);
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      return;
    }
    const timeoutId = window.setTimeout(() => setShouldRender(false), 160);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);
  return shouldRender;
}

function useDismissModelMenu({
  isOpen,
  menuRef,
  setIsOpen,
}: {
  isOpen: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  setIsOpen: (isOpen: boolean) => void;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, menuRef, setIsOpen]);
}
