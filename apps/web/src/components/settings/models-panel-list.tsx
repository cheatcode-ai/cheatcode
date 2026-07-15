import type { ReactNode } from "react";
import { ChevronDown, Loader2 } from "@/components/ui/icons";
import { ProviderMark } from "@/components/ui/provider-mark";
import { cn } from "@/lib/ui/cn";
import {
  CATALOG_PROVIDER_LABELS,
  type CatalogModel,
  isModelUsable,
  type ModelAccessState,
  type ModelSourceChoice,
  modelAccessState,
  modelSourceChoices,
  modelSourceLabel,
  ORDERED_MODELS,
  shortModelLabel,
} from "./models-panel-model";
import { ModelSourceList } from "./models-source-list";
import type { useModelsPanelController } from "./use-models-panel-controller";

type ModelsController = ReturnType<typeof useModelsPanelController>;

export function ModelsCatalog({ controller }: { controller: ModelsController }) {
  return (
    <div className="flex flex-col divide-y divide-background overflow-hidden rounded-[21px] bg-background ring-1 ring-border/50 dark:divide-border dark:bg-secondary">
      <AutoModelRow controller={controller} />
      {ORDERED_MODELS.map((model) => (
        <CatalogModelRow controller={controller} key={model.id} model={model} />
      ))}
    </div>
  );
}

function AutoModelRow({ controller }: { controller: ModelsController }) {
  const usesKeys = controller.autoKeyProvider !== undefined;
  return (
    <ModelRow
      control={
        <span className="pointer-events-none text-[13px] text-fg-secondary underline decoration-dotted underline-offset-2">
          Always on
        </span>
      }
      expanded={controller.expandedSourceId === "auto"}
      icon={<ModelIcon label="Auto" provider="auto" />}
      label="Auto"
      onSelectSource={controller.selectSourceChoice}
      onToggleExpanded={() => controller.toggleExpanded("auto")}
      sourceChoices={autoSourceChoices(controller.autoKeyProvider)}
      sourceLabel={usesKeys ? "via Your keys" : "Included by Cheatcode"}
    />
  );
}

function CatalogModelRow({
  controller,
  model,
}: {
  controller: ModelsController;
  model: CatalogModel;
}) {
  const accessState = modelAccessState(
    model,
    controller.keySummaries,
    controller.keysQuery.isLoading,
    controller.keysQuery.isError,
  );
  const enabled = isModelUsable(accessState) && !controller.disabledModelIds.has(model.id);
  return (
    <ModelRow
      control={
        <ModelControl
          accessState={accessState}
          disabled={controller.profileQuery.isLoading || controller.mutation.isPending}
          enabled={enabled}
          label={model.label}
          onConnect={() => controller.focusProviderKey(model.provider)}
          onToggle={() => controller.toggleModel(model, !enabled)}
          providerLabel={CATALOG_PROVIDER_LABELS[model.provider]}
        />
      }
      expanded={controller.expandedSourceId === model.id}
      icon={<ModelIcon label={model.label} provider={model.provider} />}
      label={shortModelLabel(model.label)}
      onSelectSource={controller.selectSourceChoice}
      onToggleExpanded={() => controller.toggleExpanded(model.id)}
      sourceChoices={modelSourceChoices(model, accessState, controller.keySummaries)}
      sourceLabel={modelSourceLabel(model, accessState)}
    />
  );
}

function autoSourceChoices(provider: ModelsController["autoKeyProvider"]): ModelSourceChoice[] {
  return [
    { active: provider === undefined, id: "included", label: "Included by Cheatcode" },
    {
      active: provider !== undefined,
      id: "keys",
      label: "Your keys",
      ...(provider ? { provider } : {}),
    },
  ];
}

function ModelRow({
  control,
  expanded,
  icon,
  label,
  onSelectSource,
  onToggleExpanded,
  sourceChoices,
  sourceLabel,
}: {
  control: ReactNode;
  expanded: boolean;
  icon: ReactNode;
  label: string;
  onSelectSource: (choice: ModelSourceChoice) => void;
  onToggleExpanded: () => void;
  sourceChoices: ModelSourceChoice[];
  sourceLabel: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-[21px] transition-colors duration-200 ease-out",
        expanded ? "bg-secondary/40" : "bg-transparent",
      )}
    >
      <ModelRowHeader {...{ control, expanded, icon, label, onToggleExpanded, sourceLabel }} />
      <div
        aria-hidden={!expanded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <ModelSourceList choices={sourceChoices} onSelect={onSelectSource} open={expanded} />
        </div>
      </div>
    </div>
  );
}

function ModelRowHeader({
  control,
  expanded,
  icon,
  label,
  onToggleExpanded,
  sourceLabel,
}: {
  control: ReactNode;
  expanded: boolean;
  icon: ReactNode;
  label: string;
  onToggleExpanded: () => void;
  sourceLabel: string;
}) {
  return (
    <div className="group/row relative flex items-center justify-between gap-3 rounded-[21px] px-4 py-3 transition-colors hover:bg-secondary/40 dark:hover:bg-white/2">
      <button
        aria-expanded={expanded}
        aria-label={`Configure provider for ${label}`}
        className="absolute inset-0 cursor-pointer rounded-[14px] outline-none"
        onClick={onToggleExpanded}
        type="button"
      />
      <div className="pointer-events-none relative z-10 flex min-w-0 items-center gap-3">
        {icon}
        <ModelRowLabel expanded={expanded} label={label} sourceLabel={sourceLabel} />
      </div>
      <div className="relative z-10 shrink-0">{control}</div>
    </div>
  );
}

function ModelRowLabel({
  expanded,
  label,
  sourceLabel,
}: {
  expanded: boolean;
  label: string;
  sourceLabel: string;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-[15px] text-foreground leading-[18.75px]">
        {label}
      </div>
      <div className="flex max-w-full items-center gap-1 text-[14px] text-placeholder leading-5">
        <span className="truncate">{sourceLabel}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 transition-transform duration-200 ease-out",
            expanded ? "rotate-180" : "rotate-0",
          )}
        />
      </div>
    </div>
  );
}

function ModelIcon({
  label,
  provider,
}: {
  label: string;
  provider: "auto" | CatalogModel["provider"];
}) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-secondary/40 ring-1 ring-border/60 transition-colors group-hover/row:ring-border">
      <ProviderGlyph provider={provider} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ProviderGlyph({ provider }: { provider: "auto" | CatalogModel["provider"] }) {
  const className =
    provider === "auto"
      ? "h-5 w-5 text-[#f5a623]"
      : provider === "anthropic"
        ? "h-5 w-5 text-[#e55f4e]"
        : provider === "openai"
          ? "h-5 w-5 text-foreground"
          : "h-5 w-5 text-[#4169e1]";
  return <ProviderMark className={className} provider={provider} />;
}

function ModelControl({
  accessState,
  disabled,
  enabled,
  label,
  onConnect,
  onToggle,
  providerLabel,
}: {
  accessState: ModelAccessState;
  disabled: boolean;
  enabled: boolean;
  label: string;
  onConnect: () => void;
  onToggle: () => void;
  providerLabel: string;
}) {
  if (accessState === "loading") {
    return <ModelStatusLoading />;
  }
  if (["missing", "disabled", "error"].includes(accessState)) {
    return (
      <ModelConnectButton
        accessState={accessState}
        label={label}
        onConnect={onConnect}
        providerLabel={providerLabel}
      />
    );
  }
  return <ModelToggle disabled={disabled} enabled={enabled} label={label} onToggle={onToggle} />;
}

function ModelStatusLoading() {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-full bg-secondary px-3 font-medium text-[12px] text-fg-secondary">
      <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
      Checking
    </span>
  );
}

function ModelConnectButton({
  accessState,
  label,
  onConnect,
  providerLabel,
}: {
  accessState: ModelAccessState;
  label: string;
  onConnect: () => void;
  providerLabel: string;
}) {
  const labelPrefix = accessState === "missing" ? "Connect" : "Review";
  return (
    <button
      aria-label={`${labelPrefix} ${providerLabel} key for ${label}`}
      className="inline-flex h-8 items-center justify-center rounded-full bg-foreground px-3 font-medium text-[14px] text-background shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_3px_rgba(0,0,0,0.2)] transition-colors hover:bg-foreground/90"
      onClick={onConnect}
      type="button"
    >
      {accessState === "missing" ? "Connect" : "Review key"}
    </button>
  );
}

function ModelToggle({
  disabled,
  enabled,
  label,
  onToggle,
}: {
  disabled: boolean;
  enabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      aria-checked={enabled}
      aria-label={`Toggle ${label}`}
      className={cn(
        "group relative inline-flex h-5 w-8 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        enabled ? "bg-foreground" : "bg-bg-secondary",
      )}
      disabled={disabled}
      onClick={onToggle}
      role="switch"
      type="button"
    >
      {disabled ? (
        <Loader2 aria-hidden="true" className="mx-auto h-3 w-3 animate-spin text-background" />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "block h-4 w-[var(--thumb-w)] rounded-full bg-background transition-[width,translate,background-color] duration-150 [--thumb-w:16px] group-hover:[--thumb-w:18px] group-active:[--thumb-w:20px]",
            enabled ? "translate-x-[calc(1.75rem-var(--thumb-w))]" : "translate-x-0",
          )}
        />
      )}
    </button>
  );
}
