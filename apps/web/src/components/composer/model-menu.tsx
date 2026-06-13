"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "@/components/ui/icons";
import { AGENT_MODEL_OPTIONS } from "@/lib/agent-models";
import { useProfileQuery } from "@/lib/hooks/use-profile";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

/**
 * Model picker over the design catalog (`AGENT_MODEL_OPTIONS` — Auto + 4 models;
 * Gemini and the standalone OpenRouter row are pruned by the catalog). Persists
 * via the zustand `agentModelId` slice (localStorage), rides the per-run `model`
 * body param, and reflects the user's disabled models from their profile.
 */
export function ModelMenu({ variant = "thread" }: { variant?: "home" | "thread" }) {
  const agentModelId = useAppStore((state) => state.agentModelId);
  const setAgentModelId = useAppStore((state) => state.setAgentModelId);
  const profileQuery = useProfileQuery();
  const disabledModels = profileQuery.data?.disabledModels ?? [];
  const [isOpen, setIsOpen] = useState(false);
  const label = AGENT_MODEL_OPTIONS.find((option) => option.id === agentModelId)?.label ?? "Auto";

  return (
    <div className="relative">
      <button
        aria-expanded={isOpen}
        aria-label={`Model: ${label}`}
        className={cn(
          variant === "home"
            ? "mr-2 hidden h-10 items-center gap-2 rounded-none border border-white/5 bg-gradient-to-b from-[#333] to-[#1a1a1a] px-3 font-mono text-[10px] text-zinc-400 uppercase tracking-widest shadow-[0_1px_2px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all hover:from-[#3a3a3a] hover:to-[#222] hover:text-white md:flex"
            : "hidden h-8 items-center gap-2 rounded-md px-2 font-mono text-[10px] text-zinc-500 uppercase tracking-widest transition-colors hover:bg-zinc-800/40 hover:text-zinc-300 md:flex",
        )}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        {variant === "home" ? <span className="font-bold text-white text-xs">AI</span> : null}
        <span>{label}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {isOpen ? (
        <ModelMenuList
          activeId={agentModelId}
          disabledModels={disabledModels}
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
  onClose,
  onSelect,
}: {
  activeId: string;
  disabledModels: readonly string[];
  onClose: () => void;
  onSelect: (id: (typeof AGENT_MODEL_OPTIONS)[number]["id"]) => void;
}) {
  return (
    <div className="absolute right-0 bottom-full z-30 mb-2 w-64 border border-white/10 bg-[#09090b] p-1 shadow-2xl">
      {AGENT_MODEL_OPTIONS.map((option) => {
        const isDisabled = option.id !== "auto" && disabledModels.includes(option.id);
        return (
          <button
            className={cn(
              "flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left transition-colors",
              isDisabled
                ? "cursor-not-allowed text-zinc-600"
                : option.id === activeId
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
            )}
            disabled={isDisabled}
            key={option.id}
            onClick={() => onSelect(option.id)}
            type="button"
          >
            <span className="font-mono text-[11px] uppercase tracking-widest">{option.label}</span>
            <span className="text-[11px] text-zinc-500 leading-snug">
              {isDisabled ? "Disabled in settings" : option.description}
            </span>
          </button>
        );
      })}
      <Link
        className="mt-1 flex h-8 items-center border-white/5 border-t px-2 font-mono text-[10px] text-zinc-500 uppercase tracking-widest transition-colors hover:text-zinc-300"
        href="/settings/agents"
        onClick={onClose}
      >
        Configure
      </Link>
    </div>
  );
}
