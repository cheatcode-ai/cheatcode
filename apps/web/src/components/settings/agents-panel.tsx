"use client";

import {
  AGENT_MODEL_CATALOG,
  FALLBACK_MODEL_ID,
  FREE_DEEPSEEK_MODEL_ID,
  type Provider,
  type ProviderKeySummary,
} from "@cheatcode/types";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Loader2 } from "@/components/ui/icons";
import { ProviderMark } from "@/components/ui/provider-mark";
import { useProfileQuery, useUpdateProfileMutation } from "@/lib/hooks/use-profile";
import { useProviderKeysQuery } from "@/lib/hooks/use-provider-keys";
import { cn } from "@/lib/ui/cn";
import { ProviderKeysPanel } from "./provider-keys-panel";
import { SettingsHeading } from "./settings-heading";

type CatalogModel = (typeof AGENT_MODEL_CATALOG)[number];
type ModelAccessState = "active" | "disabled" | "error" | "free" | "loading" | "missing";

type ModelSourceChoice = {
  id: string;
  label: string;
  active?: boolean;
  provider?: Provider;
  unavailableMessage?: string;
};

const MODEL_API_KEY_PROVIDERS = [
  "openai",
  "anthropic",
  "openrouter",
  "deepseek",
] as const satisfies readonly Provider[];

const CATALOG_PROVIDER_LABELS = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  openai: "OpenAI",
} satisfies Record<CatalogModel["provider"], string>;

const PROVIDER_LABELS = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  exa: "Exa",
  firecrawl: "Firecrawl",
  google: "Gemini",
  llamaparse: "LlamaParse",
  openai: "OpenAI",
  openrouter: "OpenRouter",
} satisfies Record<Provider, string>;

export function AgentsPanel() {
  const [activeKeyProvider, setActiveKeyProvider] = useState<Provider>("openai");
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const profileQuery = useProfileQuery();
  const keysQuery = useProviderKeysQuery();
  const mutation = useUpdateProfileMutation();
  const disabledModels = profileQuery.data?.disabledModels ?? [];
  const orderedModels = orderModelsForModelsPage();
  const keySummaries = keysQuery.data ?? [];
  const enabledUsableCount = orderedModels.filter(
    (model) =>
      isModelUsable(
        modelAccessState(model, keySummaries, keysQuery.isLoading, keysQuery.isError),
      ) && !disabledModels.includes(model.id),
  ).length;

  function toggleModel(model: CatalogModel, nextEnabled: boolean) {
    const accessState = modelAccessState(
      model,
      keySummaries,
      keysQuery.isLoading,
      keysQuery.isError,
    );
    if (!nextEnabled && isModelUsable(accessState) && enabledUsableCount <= 1) {
      toast.error("Keep at least one model enabled.");
      return;
    }
    const next = nextEnabled
      ? disabledModels.filter((modelId) => modelId !== model.id)
      : [...disabledModels, model.id];
    mutation.mutate({ disabledModels: next });
  }

  function focusProviderKey(provider: Provider) {
    setActiveKeyProvider(provider);
    requestAnimationFrame(() => {
      document.getElementById("api-keys")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function selectSourceChoice(choice: ModelSourceChoice) {
    if (choice.unavailableMessage) {
      toast.info(choice.unavailableMessage);
      return;
    }
    if (choice.provider) {
      focusProviderKey(choice.provider);
    }
  }

  return (
    <div className="text-[#1b1b1b]">
      <SettingsHeading
        description="Choose which models appear in Cheatcode, set routing preferences, and connect your API keys."
        title="Models"
      />
      <section className="rounded-3xl bg-[#f7f7f7] p-1">
        <div className="flex items-center px-4 pt-2 pb-3">
          <span className="font-medium text-[#585858] text-[14px]">Agent Models</span>
        </div>
        <div className="flex flex-col rounded-[21px] bg-white ring-1 ring-[#f1f1f1]/70">
          <ModelRow
            control={<span className="text-[#707070] text-[13px] underline">Always on</span>}
            expanded={expandedSourceId === "auto"}
            icon={<ModelIcon label="Auto" provider="auto" />}
            label="Auto"
            onSelectSource={selectSourceChoice}
            onToggleExpanded={() =>
              setExpandedSourceId((current) => (current === "auto" ? null : "auto"))
            }
            sourceChoices={[
              { active: true, id: "credits", label: "Cheatcode Credits" },
              { id: "keys", label: "Your keys", provider: "openrouter" },
            ]}
            sourceLabel="via Cheatcode credits"
          />
          {orderedModels.map((model) => {
            const accessState = modelAccessState(
              model,
              keySummaries,
              keysQuery.isLoading,
              keysQuery.isError,
            );
            const enabled = isModelUsable(accessState) && !disabledModels.includes(model.id);
            const rowId = model.id;
            return (
              <ModelRow
                control={
                  <ModelControl
                    accessState={accessState}
                    disabled={profileQuery.isLoading || mutation.isPending}
                    enabled={enabled}
                    label={model.label}
                    onConnect={() => focusProviderKey(model.provider)}
                    onToggle={() => toggleModel(model, !enabled)}
                    providerLabel={CATALOG_PROVIDER_LABELS[model.provider]}
                  />
                }
                description={model.description}
                expanded={expandedSourceId === rowId}
                icon={<ModelIcon label={model.label} provider={model.provider} />}
                key={model.id}
                label={shortModelLabel(model.label)}
                onSelectSource={selectSourceChoice}
                onToggleExpanded={() =>
                  setExpandedSourceId((current) => (current === rowId ? null : rowId))
                }
                sourceChoices={modelSourceChoices(model, accessState, keySummaries)}
                sourceLabel={modelSourceLabel(model, accessState)}
              />
            );
          })}
        </div>
        {profileQuery.isError ? (
          <p className="px-4 pt-3 pb-2 text-red-700 text-xs">
            Model settings are temporarily unavailable. Toggles will retry once the profile loads.
          </p>
        ) : null}
      </section>
      <div className="mt-6">
        <ProviderKeysPanel
          activeProvider={activeKeyProvider}
          onActiveProviderChange={setActiveKeyProvider}
          providers={MODEL_API_KEY_PROVIDERS}
          showHeading={false}
          variant="compact"
        />
      </div>
    </div>
  );
}

function orderModelsForModelsPage(): readonly CatalogModel[] {
  return [
    ...AGENT_MODEL_CATALOG.filter((model) => model.id !== FREE_DEEPSEEK_MODEL_ID),
    ...AGENT_MODEL_CATALOG.filter((model) => model.id === FREE_DEEPSEEK_MODEL_ID),
  ];
}

function modelAccessState(
  model: CatalogModel,
  summaries: ProviderKeySummary[],
  isLoading: boolean,
  isError: boolean,
): ModelAccessState {
  if (model.id === FREE_DEEPSEEK_MODEL_ID) {
    return "free";
  }
  if (isLoading) {
    return "loading";
  }
  if (isError) {
    return "error";
  }
  const summary = summaries.find((item) => item.provider === model.provider);
  if (!summary) {
    return "missing";
  }
  return summary.disabledAt === null ? "active" : "disabled";
}

function isModelUsable(accessState: ModelAccessState): boolean {
  return accessState === "active" || accessState === "free";
}

function modelSourceLabel(model: CatalogModel, accessState: ModelAccessState): string {
  if (accessState === "free") {
    return "via Cheatcode credits";
  }
  if (accessState === "loading") {
    return "checking key status";
  }
  if (accessState === "error") {
    return "key status unavailable";
  }
  const providerLabel = CATALOG_PROVIDER_LABELS[model.provider];
  if (accessState === "missing") {
    return `Add ${providerLabel} API key`;
  }
  if (accessState === "disabled") {
    return `${providerLabel} API key disabled`;
  }
  if (model.id === FALLBACK_MODEL_ID) {
    return `fallback via ${providerLabel} API key`;
  }
  return `via ${providerLabel} API key`;
}

function modelSourceChoices(
  model: CatalogModel,
  accessState: ModelAccessState,
  summaries: ProviderKeySummary[],
): ModelSourceChoice[] {
  let providers: Provider[] = [];
  if (model.provider === "anthropic") {
    providers = ["anthropic", "openrouter"];
  } else if (model.provider === "openai") {
    providers = ["openai", "openrouter"];
  } else if (model.provider === "deepseek") {
    providers = ["deepseek"];
  }

  const choices: ModelSourceChoice[] = [
    accessState === "free"
      ? { active: true, id: "credits", label: "Cheatcode Credits" }
      : {
          active: false,
          id: "credits",
          label: "Cheatcode Credits",
          unavailableMessage: "Cheatcode credits are available for DeepSeek V4.",
        },
    ...providers.map(
      (provider): ModelSourceChoice => ({
        active: provider === model.provider && accessState === "active",
        id: provider,
        label: `${PROVIDER_LABELS[provider]} API key`,
        provider,
      }),
    ),
  ];

  return choices.map((choice) => {
    if (!choice.provider) {
      return choice;
    }
    const summary = summaries.find((item) => item.provider === choice.provider);
    return {
      ...choice,
      active: choice.active || summary?.disabledAt === null,
    };
  });
}

function shortModelLabel(label: string): string {
  return label.replace("Claude ", "").replace("GPT-", "GPT-");
}

function ModelRow({
  control,
  description,
  expanded,
  icon,
  label,
  onSelectSource,
  onToggleExpanded,
  sourceChoices,
  sourceLabel,
}: {
  control: ReactNode;
  description?: string;
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
        "flex flex-col overflow-hidden rounded-[21px] transition-colors duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
        expanded ? "bg-[#fafafa]" : "hover:bg-[#fafafa]",
      )}
    >
      <div className="relative flex min-h-16 items-center justify-between gap-3 rounded-[21px] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {icon}
          <div className="min-w-0">
            <div className="truncate font-medium text-[#1b1b1b] text-[15px] leading-[19px]">
              {label}
            </div>
            <button
              aria-expanded={expanded}
              className="flex max-w-full items-center gap-1 rounded-full text-[#666666] text-[14px] leading-5 outline-none transition-colors duration-150 hover:text-[#1b1b1b] focus-visible:ring-2 focus-visible:ring-[#1b1b1b]/10"
              onClick={onToggleExpanded}
              type="button"
            >
              <span className="truncate">{sourceLabel}</span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "h-3 w-3 shrink-0 transition-transform",
                  expanded ? "rotate-180" : "rotate-0",
                )}
              />
            </button>
            {description ? (
              <p className="mt-0.5 line-clamp-1 text-[#9a9a9a] text-[12px] leading-4">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        <div className="shrink-0">{control}</div>
      </div>
      <div
        aria-hidden={!expanded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
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

function ModelSourceList({
  choices,
  onSelect,
  open,
}: {
  choices: ModelSourceChoice[];
  onSelect: (choice: ModelSourceChoice) => void;
  open: boolean;
}) {
  return (
    <div
      className={cn(
        "mr-4 mb-4 ml-[76px] transform-gpu transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
        open ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
      )}
    >
      <div className="relative flex flex-col pl-8">
        {choices.map((choice, index) => {
          const isLast = index === choices.length - 1;
          const branch = choice.active ? "#1b1b1b" : "#e3e3e3";
          return (
            <div className="group/item relative z-10" key={choice.id}>
              {/* rounded elbow from the tree line into this item */}
              <span
                aria-hidden="true"
                className="absolute top-2 -left-8 z-10 h-2.5 w-4 rounded-bl-[10px] border-b-[1.5px] border-l-[1.5px]"
                style={{ borderColor: branch }}
              />
              {/* line segment above the elbow (dark on the selected branch) */}
              <span
                aria-hidden="true"
                className="absolute top-0 -left-8 h-2 w-[1.5px]"
                style={{ backgroundColor: branch }}
              />
              {/* line segment continuing down to the next item */}
              {isLast ? null : (
                <span
                  aria-hidden="true"
                  className="absolute top-2 -bottom-1 -left-8 w-[1.5px] bg-[#e3e3e3]"
                />
              )}
              {/* filled check node at the elbow end, only for the active source */}
              {choice.active ? (
                <span
                  aria-hidden="true"
                  className="absolute top-[18px] -left-3.5 z-10 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#1b1b1b] text-white"
                >
                  <Check aria-hidden="true" className="size-2.5" strokeWidth={2.5} />
                </span>
              ) : null}
              <button
                aria-current={choice.active ? "true" : undefined}
                className="flex h-[35px] w-full items-center rounded-[10px] px-3 text-left font-medium text-[#1b1b1b] text-[15px] leading-[19px] outline-none transition-colors duration-150 hover:bg-black/[0.04]"
                onClick={() => onSelect(choice)}
                tabIndex={open ? 0 : -1}
                type="button"
              >
                <span className="min-w-0 truncate">{choice.label}</span>
              </button>
            </div>
          );
        })}
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
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#fbfbfb] ring-1 ring-[#f1f1f1]/60">
      <ProviderGlyph provider={provider} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ProviderGlyph({ provider }: { provider: "auto" | CatalogModel["provider"] }) {
  if (provider === "auto") {
    return <ProviderMark className="h-5 w-5 text-[#f5a623]" provider={provider} />;
  }
  if (provider === "anthropic") {
    return <ProviderMark className="h-5 w-5 text-[#e55f4e]" provider={provider} />;
  }
  if (provider === "openai") {
    return <ProviderMark className="h-5 w-5 text-[#1b1b1b]" provider={provider} />;
  }
  return <ProviderMark className="h-5 w-5 text-[#4169e1]" provider={provider} />;
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
    return (
      <span className="inline-flex h-8 items-center gap-2 rounded-full bg-[#f7f7f7] px-3 font-medium text-[#707070] text-[12px]">
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        Checking
      </span>
    );
  }

  if (accessState === "missing" || accessState === "disabled" || accessState === "error") {
    const labelPrefix = accessState === "missing" ? "Connect" : "Review";
    return (
      <button
        aria-label={`${labelPrefix} ${providerLabel} key for ${label}`}
        className="inline-flex h-8 items-center justify-center rounded-full bg-[#1b1b1b] px-3 font-medium text-[14px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_3px_rgba(0,0,0,0.2)] transition-colors hover:bg-black"
        onClick={onConnect}
        type="button"
      >
        {accessState === "missing" ? "Connect" : "Review key"}
      </button>
    );
  }

  return <ModelToggle disabled={disabled} enabled={enabled} label={label} onToggle={onToggle} />;
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
      aria-label={`${enabled ? "Disable" : "Enable"} ${label}`}
      aria-pressed={enabled}
      className={cn(
        "relative inline-flex h-5 w-8 items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        enabled ? "bg-[#1b1b1b]" : "bg-[#e4e4e4]",
      )}
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      {disabled ? (
        <Loader2 aria-hidden="true" className="mx-auto h-3 w-3 animate-spin text-white" />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
            enabled ? "translate-x-3" : "translate-x-0",
          )}
        />
      )}
    </button>
  );
}
