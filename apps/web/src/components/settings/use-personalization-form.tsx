"use client";

import type { UpdateUserProfile, UserProfile } from "@cheatcode/types";
import { Loader2 } from "@cheatcode/ui";
import { useState } from "react";
import { toast } from "sonner";
import { useUpdateProfileMutation } from "@/lib/hooks/use-profile";

export interface PersonalizationFormState {
  memory: string;
  name: string;
}

export function usePersonalizationForm(profile: UserProfile) {
  const mutation = useUpdateProfileMutation();
  const [form, setForm] = useState<PersonalizationFormState>(() => initialForm(profile));
  const patch = buildPatch(profile, form);
  const isDirty = Object.keys(patch).length > 0;
  function update(key: keyof PersonalizationFormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  function save() {
    if (!isDirty) {
      toast.message("Nothing to save");
      return;
    }
    mutation.mutate(patch, {
      onSuccess: () => toast.success("Personalization saved"),
    });
  }
  return {
    form,
    isDirty,
    loader: <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />,
    mutation,
    save,
    update,
  };
}

function initialForm(profile: UserProfile): PersonalizationFormState {
  return {
    memory: profile.globalMemory ?? "",
    name: profile.agentDisplayName ?? "",
  };
}

function buildPatch(profile: UserProfile, form: PersonalizationFormState): UpdateUserProfile {
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
