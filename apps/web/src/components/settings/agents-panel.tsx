"use client";

import {
  AGENT_MODEL_CATALOG,
  type CatalogModelId,
  FALLBACK_MODEL_ID,
  FREE_DEEPSEEK_MODEL_ID,
} from "@cheatcode/types";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Loader2 } from "@/components/ui/icons";
import { useProfileQuery, useUpdateProfileMutation } from "@/lib/hooks/use-profile";
import { cn } from "@/lib/ui/cn";
import { SettingsHeading } from "./settings-heading";

type CatalogModel = (typeof AGENT_MODEL_CATALOG)[number];

export function AgentsPanel() {
  const profileQuery = useProfileQuery();
  const mutation = useUpdateProfileMutation();
  const disabledModels = profileQuery.data?.disabledModels ?? [];
  const freeDeepseek = profileQuery.data?.freeDeepseek;
  const enabledCount = AGENT_MODEL_CATALOG.length - disabledModels.length;

  function toggleModel(id: CatalogModelId, nextEnabled: boolean) {
    if (!nextEnabled && enabledCount <= 1) {
      toast.error("Keep at least one model enabled.");
      return;
    }
    const next = nextEnabled
      ? disabledModels.filter((modelId) => modelId !== id)
      : [...disabledModels, id];
    mutation.mutate({ disabledModels: next });
  }

  return (
    <div className="flex flex-col items-center text-zinc-200">
      <SettingsHeading
        description="DeepSeek is free for everyone — up to 200K tokens. Bring your own keys to unlock the rest. Auto routes per task and stays on."
        title="Models"
      />
      <div className="w-full max-w-2xl space-y-3">
        <ModelRow
          control={
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Always on</span>
          }
          description="Routes each run to the best available model for the task."
          label="Auto"
        />
        {orderModelsFreeFirst().map((model) => {
          const enabled = !disabledModels.includes(model.id);
          const isFree = model.id === FREE_DEEPSEEK_MODEL_ID;
          return (
            <ModelRow
              control={
                <ModelToggle
                  disabled={profileQuery.isLoading || mutation.isPending}
                  enabled={enabled}
                  label={model.label}
                  onToggle={() => toggleModel(model.id, !enabled)}
                />
              }
              description={modelSourceLabel(model)}
              extra={
                isFree && freeDeepseek ? (
                  <FreeCreditMeter limit={freeDeepseek.limit} used={freeDeepseek.used} />
                ) : null
              }
              key={model.id}
              label={model.label}
            />
          );
        })}
        {profileQuery.isError ? (
          <p className="text-red-300 text-xs">
            Model settings are temporarily unavailable. Toggles will retry once the profile loads.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The free DeepSeek model renders first; the rest keep their catalog order. */
function orderModelsFreeFirst(): readonly CatalogModel[] {
  return [
    ...AGENT_MODEL_CATALOG.filter((model) => model.id === FREE_DEEPSEEK_MODEL_ID),
    ...AGENT_MODEL_CATALOG.filter((model) => model.id !== FREE_DEEPSEEK_MODEL_ID),
  ];
}

function modelSourceLabel(model: CatalogModel): string {
  if (model.id === FREE_DEEPSEEK_MODEL_ID) {
    return "via free credits";
  }
  if (model.id === FALLBACK_MODEL_ID) {
    return "fallback";
  }
  if (model.provider === "anthropic") {
    return "via your Anthropic key";
  }
  return "via your OpenAI key";
}

function ModelRow({
  control,
  description,
  extra,
  label,
}: {
  control: ReactNode;
  description: string;
  extra?: ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800/80 bg-[#111] px-5 py-4 shadow-xl">
      <div className="min-w-0">
        <div className="font-medium text-sm text-white">{label}</div>
        <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{description}</p>
        {extra}
      </div>
      <div className="flex shrink-0 items-center">{control}</div>
    </div>
  );
}

function FreeCreditMeter({ limit, used }: { limit: number; used: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const remaining = Math.max(0, limit - used);
  return (
    <div className="mt-2 max-w-xs">
      <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn("h-full rounded-full", remaining > 0 ? "bg-purple-500" : "bg-red-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        {formatTokens(used)} of {formatTokens(limit)} free tokens used
      </p>
    </div>
  );
}

function formatTokens(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}K` : String(value);
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
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        enabled ? "bg-purple-500" : "bg-zinc-700",
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
            enabled ? "translate-x-6" : "translate-x-1",
          )}
        />
      )}
    </button>
  );
}
