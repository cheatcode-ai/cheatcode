"use client";

import { AGENT_MODEL_CATALOG, type CatalogModelId } from "@cheatcode/types";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Loader2 } from "@/components/ui/icons";
import { useProfileQuery, useUpdateProfileMutation } from "@/lib/hooks/use-profile";
import { cn } from "@/lib/ui/cn";
import { SettingsHeading } from "./settings-heading";

export function AgentsPanel() {
  const profileQuery = useProfileQuery();
  const mutation = useUpdateProfileMutation();
  const disabledModels = profileQuery.data?.disabledModels ?? [];
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
        description="Choose which models agent runs may use. Auto routes per task and stays on. Defaults live in Personalization."
        title="Models & keys"
      />
      <div className="w-full max-w-2xl space-y-3">
        <ModelRow
          control={
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Always on</span>
          }
          description="Routes each run to the best enabled model for the task."
          label="Auto"
        />
        {AGENT_MODEL_CATALOG.map((model) => {
          const enabled = !disabledModels.includes(model.id);
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
              description={model.description}
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

function ModelRow({
  control,
  description,
  label,
}: {
  control: ReactNode;
  description: string;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800/80 bg-[#111] px-5 py-4 shadow-xl">
      <div className="min-w-0">
        <div className="font-medium text-sm text-white">{label}</div>
        <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{description}</p>
      </div>
      <div className="flex shrink-0 items-center">{control}</div>
    </div>
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
