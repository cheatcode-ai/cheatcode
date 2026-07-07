"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BudTooltip } from "@/components/ui/bud-tooltip";
import { Check, ChevronDown, SlidersHorizontal } from "@/components/ui/icons";
import { ProviderMark } from "@/components/ui/provider-mark";
import {
  AGENT_MODEL_OPTIONS,
  type AgentModelOption,
  type AgentModelProvider,
  DEFAULT_AGENT_MODEL_OPTION,
} from "@/lib/agent-models";
import { useProfileQuery } from "@/lib/hooks/use-profile";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

/**
 * Model picker over the design catalog (`AGENT_MODEL_OPTIONS` - Auto + 4 models;
 * Gemini and the standalone OpenRouter row are pruned by the catalog). Persists
 * via the zustand `agentModelId` slice (localStorage), rides the per-run `model`
 * body param, and reflects the user's disabled models from their profile.
 */
export function ModelMenu({
  onOpenChange,
  open,
  variant = "thread",
}: {
  onOpenChange?: ((open: boolean) => void) | undefined;
  open?: boolean | undefined;
  variant?: "home" | "thread";
}) {
  const agentModelId = useAppStore((state) => state.agentModelId);
  const setAgentModelId = useAppStore((state) => state.setAgentModelId);
  const profileQuery = useProfileQuery();
  const disabledModels = profileQuery.data?.disabledModels ?? [];
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;
  const [renderMenu, setRenderMenu] = useState(isOpen);
  const activeOption = agentModelOption(agentModelId);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setRenderMenu(true);
      return;
    }

    const timeoutId = window.setTimeout(() => setRenderMenu(false), 160);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, setIsOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <BudTooltip label="Model">
        <button
          aria-expanded={isOpen}
          aria-label={`Model: ${activeOption.label}`}
          className={cn(
            variant === "home"
              ? "mr-1 hidden h-7 max-w-[190px] items-center gap-2 rounded-lg px-2 font-medium text-[#5f5f5f] text-[13px] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b] md:flex"
              : "hidden h-7 max-w-[190px] items-center gap-2 rounded-lg px-2 font-medium text-[#707070] text-[13px] transition-colors hover:bg-white hover:text-[#1b1b1b] md:flex",
          )}
          onClick={() => setIsOpen(!isOpen)}
          type="button"
        >
          <ProviderIcon className="h-4 w-4 shrink-0" option={activeOption} />
          <span className="truncate">{modelMenuLabel(activeOption)}</span>
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </BudTooltip>
      {renderMenu ? (
        <ModelMenuList
          activeId={activeOption.id}
          disabledModels={disabledModels}
          open={isOpen}
          onClose={() => setIsOpen(false)}
          onSelect={(id) => {
            setAgentModelId(id);
            setIsOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ModelMenuList({
  activeId,
  disabledModels,
  open,
  onClose,
  onSelect,
}: {
  activeId: string;
  disabledModels: readonly string[];
  open: boolean;
  onClose: () => void;
  onSelect: (id: (typeof AGENT_MODEL_OPTIONS)[number]["id"]) => void;
}) {
  return (
    <div
      className={cn(
        "absolute right-0 bottom-full z-30 mb-2 flex w-[190px] origin-bottom-right flex-col overflow-hidden rounded-[10px] border border-[#f1f1f1] bg-white p-1.5 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.10),0_2px_4px_-2px_rgba(0,0,0,0.10)] transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform",
        open
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-1 scale-[0.98] opacity-0",
      )}
      role="menu"
    >
      <div className="flex flex-col gap-1" role="none">
        {AGENT_MODEL_OPTIONS.map((option) => {
          const isDisabled = option.id !== "auto" && disabledModels.includes(option.id);
          const isActive = option.id === activeId;
          return (
            <button
              aria-checked={isActive}
              aria-disabled={isDisabled}
              aria-label={option.label}
              className={cn(
                "group flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-left font-medium text-[#1b1b1b] text-[13px] leading-5 transition-colors",
                isDisabled
                  ? "cursor-not-allowed text-[#b8b8b8]"
                  : isActive
                    ? "bg-[#1b1b1b]/10"
                    : "hover:bg-[#1b1b1b]/5",
              )}
              disabled={isDisabled}
              key={option.id}
              onClick={() => onSelect(option.id)}
              onPointerDown={(event) => {
                if (isDisabled) {
                  return;
                }
                event.preventDefault();
                onSelect(option.id);
              }}
              role="menuitemradio"
              title={isDisabled ? "Disabled in Models settings" : option.label}
              type="button"
            >
              <ProviderIcon
                className={cn("h-4 w-4 shrink-0", isDisabled && "opacity-40")}
                option={option}
              />
              <span className="min-w-0 flex-1 truncate">{modelMenuLabel(option)}</span>
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[#253548]">
                {isActive ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-1 border-[#f1f1f1] border-t pt-1.5">
        <Link
          className="flex min-h-8 w-full items-center justify-start gap-2 rounded-[10px] px-2 py-1.5 font-medium text-[#1b1b1b]/90 text-[13px] leading-5 transition-colors hover:bg-[#1b1b1b]/5 hover:text-[#1b1b1b]"
          href="/settings/agents"
          onClick={onClose}
          role="menuitem"
        >
          <SlidersHorizontal aria-hidden="true" className="h-4 w-4 shrink-0" />
          Configure
        </Link>
      </div>
    </div>
  );
}

function ProviderIcon({ className, option }: { className?: string; option: AgentModelOption }) {
  return (
    <span className={cn("flex items-center justify-center", className)}>
      <ProviderMark className={providerIconClassName(option.provider)} provider={option.provider} />
    </span>
  );
}

function providerIconClassName(provider: AgentModelProvider) {
  if (provider === "auto") {
    return "h-full w-full text-[#f8af2c]";
  }
  if (provider === "anthropic") {
    return "h-full w-full text-[#e55f4e]";
  }
  if (provider === "openai") {
    return "h-full w-full text-[#1b1b1b]";
  }
  return "h-full w-full text-[#4169e1]";
}

function modelMenuLabel(option: AgentModelOption) {
  if (option.provider === "anthropic") {
    return option.label.replace(/^Claude\s+/, "");
  }

  return option.label;
}

function agentModelOption(modelId: string): AgentModelOption {
  return AGENT_MODEL_OPTIONS.find((option) => option.id === modelId) ?? DEFAULT_AGENT_MODEL_OPTION;
}
