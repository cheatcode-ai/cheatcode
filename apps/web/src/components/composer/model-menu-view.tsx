"use client";

import { Check, ChevronDown, SlidersHorizontal } from "@cheatcode/ui";
import Link from "next/link";
import type { ModelMenuController } from "@/components/composer/model-menu-controller";
import { modelMenuLabel, providerIconClassName } from "@/components/composer/model-menu-model";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import { ProviderMark } from "@/components/ui/provider-mark";
import type { AgentModelOption } from "@/lib/agent-models";
import { AGENT_MODEL_OPTIONS } from "@/lib/agent-models";
import { cn } from "@/lib/ui/cn";

export function ModelMenuTrigger({
  compact,
  controller,
  variant,
}: {
  compact: boolean;
  controller: ModelMenuController;
  variant: "home" | "thread";
}) {
  const option = controller.state.displayOption;
  return (
    <CheatcodeTooltip label="Model">
      <button
        aria-controls={controller.meta.menuId}
        aria-expanded={controller.state.isOpen}
        aria-haspopup="menu"
        aria-label={`Model: ${option.label}`}
        className={modelTriggerClassName(compact, variant)}
        onClick={controller.actions.toggle}
        type="button"
      >
        <ProviderIcon className="h-4 w-4 shrink-0" option={option} />
        <span className={cn("hidden truncate", compact ? "min-[1280px]:inline" : "sm:inline")}>
          {modelMenuLabel(option)}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn("hidden h-3.5 w-3.5", compact ? "min-[1280px]:block" : "sm:block")}
        />
      </button>
    </CheatcodeTooltip>
  );
}

function modelTriggerClassName(compact: boolean, variant: "home" | "thread"): string {
  return cn(
    "flex size-7 min-w-0 items-center justify-center rounded-lg p-0 font-medium text-[12px] transition-colors",
    compact
      ? "min-[1280px]:h-7 min-[1280px]:w-auto min-[1280px]:max-w-[190px] min-[1280px]:gap-2 min-[1280px]:px-2 min-[1280px]:text-[13px]"
      : "sm:h-7 sm:w-auto sm:max-w-[190px] sm:gap-2 sm:px-2 sm:text-[13px]",
    variant === "home"
      ? "text-fg-secondary hover:bg-secondary hover:text-foreground sm:mr-1"
      : "text-fg-secondary hover:bg-background hover:text-foreground",
  );
}

export function ModelMenuList({ controller }: { controller: ModelMenuController }) {
  return (
    <div
      className={cn(
        "absolute right-0 bottom-full z-30 mb-2 flex w-[190px] origin-bottom-right flex-col overflow-hidden rounded-[10px] border border-border bg-background p-1.5 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.10),0_2px_4px_-2px_rgba(0,0,0,0.10)] transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform",
        controller.state.isOpen
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-1 scale-[0.98] opacity-0",
      )}
      id={controller.meta.menuId}
      role="menu"
    >
      <div className="flex flex-col gap-1" role="none">
        {AGENT_MODEL_OPTIONS.map((option) => (
          <ModelMenuOption controller={controller} key={option.id} option={option} />
        ))}
      </div>
      <ModelMenuConfigureLink onClose={controller.actions.close} />
    </div>
  );
}

function ModelMenuOption({
  controller,
  option,
}: {
  controller: ModelMenuController;
  option: AgentModelOption;
}) {
  const isDisabled = option.id !== "auto" && controller.state.disabledModels.includes(option.id);
  const isActive = option.id === controller.state.selectedOption.id;
  const select = () => controller.actions.select(option.id);
  return (
    <button
      aria-checked={isActive}
      aria-disabled={isDisabled}
      aria-label={option.label}
      className={modelOptionClassName(isActive, isDisabled)}
      disabled={isDisabled}
      onClick={select}
      onPointerDown={(event) => {
        if (isDisabled) return;
        event.preventDefault();
        select();
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
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-foreground">
        {isActive ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}
      </span>
    </button>
  );
}

function modelOptionClassName(isActive: boolean, isDisabled: boolean): string {
  return cn(
    "group flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-left font-medium text-[13px] text-foreground leading-5 transition-colors",
    isDisabled
      ? "cursor-not-allowed text-placeholder"
      : isActive
        ? "bg-foreground/10"
        : "hover:bg-foreground/5",
  );
}

function ModelMenuConfigureLink({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-1 border-border border-t pt-1.5">
      <Link
        className="flex min-h-8 w-full items-center justify-start gap-2 rounded-[10px] px-2 py-1.5 font-medium text-[13px] text-foreground/90 leading-5 transition-colors hover:bg-foreground/5 hover:text-foreground"
        href="/models"
        onClick={onClose}
        role="menuitem"
      >
        <SlidersHorizontal aria-hidden="true" className="h-4 w-4 shrink-0" />
        Configure
      </Link>
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
