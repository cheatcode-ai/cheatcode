"use client";

import type { UpdateUserProfile, UserProfile } from "@cheatcode/types";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "@/components/ui/icons";
import { useProfileQuery, useUpdateProfileMutation } from "@/lib/hooks/use-profile";
import { SettingsHeading } from "./settings-heading";

const MEMORY_MAX = 8_000;
const EMPTY_PROFILE: UserProfile = {
  agentDisplayName: null,
  disabledModels: [],
  globalMemory: null,
  onboardingCompletedAt: null,
  onboardingState: { steps: {} },
  updatedAt: null,
};

interface FormState {
  memory: string;
  name: string;
}

export function PersonalizationPanel() {
  const profileQuery = useProfileQuery();
  const profile = profileQuery.data ?? EMPTY_PROFILE;

  return (
    <div className="text-[#1b1b1b]">
      <SettingsHeading
        description="Name, preferences, and instructions for Cheatcode."
        title="Personalization"
      />
      <PersonalizationForm key={profile.updatedAt ?? "empty-profile"} profile={profile} />
    </div>
  );
}

function PersonalizationForm({ profile }: { profile: UserProfile }) {
  const mutation = useUpdateProfileMutation();
  const [form, setForm] = useState<FormState>(() => initialForm(profile));
  const isDirty = Object.keys(buildPatch(profile, form)).length > 0;

  function update(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSave() {
    const patch = buildPatch(profile, form);
    if (Object.keys(patch).length === 0) {
      toast.message("Nothing to save");
      return;
    }
    mutation.mutate(patch, {
      onSuccess: () => toast.success("Personalization saved"),
    });
  }

  return (
    <div className="w-full space-y-7">
      <section className="rounded-[24px] bg-[#f7f7f7] p-5">
        <FieldLabel helper="Cheatcode will answer to this name." label="Your Cheatcode's Name" />
        <div className="group mt-5 cursor-text rounded-[22px] border-2 border-[#f1f1f1] bg-white">
          <div className="rounded-[20px] bg-white p-px">
            <div className="rounded-[19px] bg-gradient-to-b from-[#f6f6f6] to-transparent px-4 py-3 transition-[box-shadow] duration-200 group-focus-within:shadow-[inset_0_0_40px_0_oklch(0.93_0.06_70_/_0.4)]">
              <input
                className="h-8 w-full bg-transparent font-medium text-[#1b1b1b] text-[14px] outline-none placeholder:text-[#6f7782]"
                maxLength={80}
                onChange={(event) => update("name", event.target.value)}
                placeholder="Give your Cheatcode a name"
                value={form.name}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] bg-[#f7f7f7] p-5">
        <FieldLabel
          helper="Preferences and instructions for Cheatcode. No need to set the name here — that's handled above."
          label="Memory"
        />
        <div className="group mt-5 cursor-text rounded-[22px] border-2 border-[#f1f1f1] bg-white">
          <div className="rounded-[20px] bg-white p-px">
            <div className="rounded-[19px] bg-gradient-to-b from-[#f6f6f6] to-transparent px-4 py-3 transition-[box-shadow] duration-200 group-focus-within:shadow-[inset_0_0_40px_0_oklch(0.93_0.06_70_/_0.4)]">
              <textarea
                className="min-h-[200px] w-full resize-none bg-transparent font-medium text-[#1b1b1b] text-[14px] leading-5 outline-none placeholder:text-[#6f7782]"
                maxLength={MEMORY_MAX}
                onChange={(event) => update("memory", event.target.value)}
                placeholder={
                  'Preferences and instructions — e.g. "I prefer short bullet points", "Always cite sources"...'
                }
                value={form.memory}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          className="paper-focus-ring inline-flex h-9 items-center justify-center rounded-full bg-[#1b1b1b] px-4 font-medium text-[14px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_3px_rgba(0,0,0,0.18)] transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-none"
          disabled={mutation.isPending || !isDirty}
          onClick={handleSave}
          type="button"
        >
          {mutation.isPending ? (
            <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          Save
        </button>
      </div>
    </div>
  );
}

function FieldLabel({ helper, label }: { helper: string; label: string }) {
  return (
    <div className="space-y-2">
      <div className="font-medium text-[#6f7782] text-[14px]">{label}</div>
      <p className="font-medium text-[#1b1b1b] text-[14px] leading-5">{helper}</p>
    </div>
  );
}

function initialForm(profile: UserProfile): FormState {
  return {
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
  return patch;
}
