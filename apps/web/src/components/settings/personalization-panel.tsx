"use client";

import {
  AGENT_MODEL_CATALOG,
  type CatalogModelId,
  isCatalogModelId,
  type UpdateUserProfile,
  type UserProfile,
} from "@cheatcode/types";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "@/components/ui/icons";
import { useProfileQuery, useUpdateProfileMutation } from "@/lib/hooks/use-profile";
import { SettingsHeading } from "./settings-heading";

const MEMORY_MAX = 8_000;

const BUDGET_OPTIONS = [
  { label: "No cap", value: "" },
  { label: "$2 per run", value: "2" },
  { label: "$5 per run", value: "5" },
  { label: "$10 per run", value: "10" },
] as const;

interface FormState {
  appBudget: string;
  appModel: string;
  generalBudget: string;
  generalModel: string;
  memory: string;
  name: string;
}

export function PersonalizationPanel() {
  const profileQuery = useProfileQuery();

  return (
    <div className="flex flex-col items-center text-zinc-200">
      <SettingsHeading
        description="Name your agent, give it standing memory, and set the model + run budget defaults for new projects."
        title="Personalization"
      />
      {profileQuery.data ? (
        <PersonalizationForm profile={profileQuery.data} />
      ) : (
        <PanelStatus isError={profileQuery.isError} />
      )}
    </div>
  );
}

function PersonalizationForm({ profile }: { profile: UserProfile }) {
  const mutation = useUpdateProfileMutation();
  const [form, setForm] = useState<FormState>(() => initialForm(profile));
  const enabledModels = AGENT_MODEL_CATALOG.filter(
    (model) => !profile.disabledModels.includes(model.id),
  );

  function update(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSave() {
    const patch = buildPatch(profile, form);
    if (Object.keys(patch).length === 0) {
      toast.message("Nothing to save");
      return;
    }
    mutation.mutate(patch);
  }

  return (
    <div className="w-full max-w-2xl space-y-8">
      <section className="space-y-3 rounded-3xl border border-zinc-800/80 bg-[#111] p-6 shadow-xl">
        <FieldLabel helper="Agents will answer to this name." label="Your agent's name" />
        <input
          className="h-11 w-full rounded-2xl border border-zinc-800 bg-[#080808] px-4 text-sm text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-zinc-700"
          maxLength={80}
          onChange={(event) => update("name", event.target.value)}
          placeholder="Give your agent a name"
          value={form.name}
        />
      </section>

      <section className="space-y-3 rounded-3xl border border-zinc-800/80 bg-[#111] p-6 shadow-xl">
        <FieldLabel
          helper="Preferences and instructions for every run. Project-specific instructions live with each project."
          label="Memory"
        />
        <textarea
          className="min-h-32 w-full resize-none rounded-2xl border border-zinc-800 bg-[#080808] px-4 py-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-zinc-700"
          maxLength={MEMORY_MAX}
          onChange={(event) => update("memory", event.target.value)}
          placeholder={
            'Preferences and instructions — e.g. "Ship Expo apps with dark mode", "Always cite sources"…'
          }
          value={form.memory}
        />
        <div className="text-right font-mono text-[10px] text-zinc-600">
          {form.memory.length.toLocaleString()} / {MEMORY_MAX.toLocaleString()}
        </div>
      </section>

      <section className="space-y-4 rounded-3xl border border-zinc-800/80 bg-[#111] p-6 shadow-xl">
        <FieldLabel
          helper="Model routing and run budgets for new projects."
          label="Agent defaults"
        />
        <AgentDefaultsRow
          budget={form.appBudget}
          enabledModels={enabledModels}
          label="App builder"
          model={form.appModel}
          onBudget={(value) => update("appBudget", value)}
          onModel={(value) => update("appModel", value)}
        />
        <AgentDefaultsRow
          budget={form.generalBudget}
          enabledModels={enabledModels}
          label="General agent"
          model={form.generalModel}
          onBudget={(value) => update("generalBudget", value)}
          onModel={(value) => update("generalModel", value)}
        />
      </section>

      <button
        className="inline-flex h-11 items-center justify-center rounded-2xl bg-white px-6 font-medium text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={mutation.isPending}
        onClick={handleSave}
        type="button"
      >
        {mutation.isPending ? (
          <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        Save changes
      </button>
    </div>
  );
}

function AgentDefaultsRow({
  budget,
  enabledModels,
  label,
  model,
  onBudget,
  onModel,
}: {
  budget: string;
  enabledModels: readonly { id: CatalogModelId; label: string }[];
  label: string;
  model: string;
  onBudget: (value: string) => void;
  onModel: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-zinc-800/70 bg-black/25 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <div className="font-medium text-sm text-zinc-200">{label}</div>
      <select
        aria-label={`${label} default model`}
        className="h-10 rounded-xl border border-zinc-800 bg-[#080808] px-3 text-sm text-zinc-200 outline-none focus:border-zinc-700"
        onChange={(event) => onModel(event.target.value)}
        value={model}
      >
        <option value="">Auto</option>
        {enabledModels.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} run budget`}
        className="h-10 rounded-xl border border-zinc-800 bg-[#080808] px-3 text-sm text-zinc-200 outline-none focus:border-zinc-700"
        onChange={(event) => onBudget(event.target.value)}
        value={budget}
      >
        {BUDGET_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FieldLabel({ helper, label }: { helper: string; label: string }) {
  return (
    <div className="space-y-1">
      <div className="font-bold font-mono text-[11px] text-zinc-500 uppercase tracking-[0.2em]">
        {label}
      </div>
      <p className="text-xs text-zinc-600 leading-relaxed">{helper}</p>
    </div>
  );
}

function PanelStatus({ isError }: { isError: boolean }) {
  if (isError) {
    return <p className="text-red-300 text-sm">Profile is temporarily unavailable.</p>;
  }
  return (
    <div className="flex h-24 items-center justify-center text-zinc-600">
      <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
    </div>
  );
}

function initialForm(profile: UserProfile): FormState {
  return {
    appBudget: budgetToValue(profile.appbuilderDefaultBudgetUsd),
    appModel: profile.appbuilderDefaultModel ?? "",
    generalBudget: budgetToValue(profile.generalDefaultBudgetUsd),
    generalModel: profile.generalDefaultModel ?? "",
    memory: profile.globalMemory ?? "",
    name: profile.agentDisplayName ?? "",
  };
}

function buildPatch(profile: UserProfile, form: FormState): UpdateUserProfile {
  const patch: UpdateUserProfile = {};
  const nextName = form.name.trim() === "" ? null : form.name.trim();
  if (nextName !== profile.agentDisplayName) {
    patch.agentDisplayName = nextName;
  }
  const nextMemory = form.memory === "" ? null : form.memory;
  if (nextMemory !== profile.globalMemory) {
    patch.globalMemory = nextMemory;
  }
  const nextAppModel = toModel(form.appModel);
  if (nextAppModel !== profile.appbuilderDefaultModel) {
    patch.appbuilderDefaultModel = nextAppModel;
  }
  const nextAppBudget = toBudget(form.appBudget);
  if (nextAppBudget !== profile.appbuilderDefaultBudgetUsd) {
    patch.appbuilderDefaultBudgetUsd = nextAppBudget;
  }
  const nextGeneralModel = toModel(form.generalModel);
  if (nextGeneralModel !== profile.generalDefaultModel) {
    patch.generalDefaultModel = nextGeneralModel;
  }
  const nextGeneralBudget = toBudget(form.generalBudget);
  if (nextGeneralBudget !== profile.generalDefaultBudgetUsd) {
    patch.generalDefaultBudgetUsd = nextGeneralBudget;
  }
  return patch;
}

function toModel(value: string): CatalogModelId | null {
  return isCatalogModelId(value) ? value : null;
}

function toBudget(value: string): number | null {
  if (value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function budgetToValue(budget: number | null): string {
  return budget === null ? "" : String(budget);
}
