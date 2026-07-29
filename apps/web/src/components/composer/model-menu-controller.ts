"use client";

import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { type AgentModelId, agentModelOption } from "@/components/composer/model-menu-model";
import type { AgentModelOption } from "@/lib/agent-models";
import { useProfileQuery } from "@/lib/hooks/use-profile";
import { useAppStore } from "@/lib/store/app-store";
import { useDismissable } from "@/lib/ui/use-dismissable";

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
    displayOption: AgentModelOption;
    disabledModels: readonly string[];
    isOpen: boolean;
    selectedOption: AgentModelOption;
    shouldRender: boolean;
  };
}

export function useModelMenuController({
  onOpenChange,
  open,
  resolvedModelId,
}: {
  onOpenChange?: ((open: boolean) => void) | undefined;
  open?: boolean | undefined;
  resolvedModelId?: null | string | undefined;
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
  const selectedOption = agentModelOption(agentModelId);
  const resolvedOption = resolvedModelId ? agentModelOption(resolvedModelId) : null;
  const displayOption =
    agentModelId === "auto" && resolvedOption && resolvedOption.id !== "auto"
      ? resolvedOption
      : selectedOption;
  useDismissable({ isOpen, onDismiss: () => setIsOpen(false), ref: menuRef });
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
    state: { displayOption, disabledModels, isOpen, selectedOption, shouldRender },
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
