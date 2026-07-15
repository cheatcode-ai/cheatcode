"use client";

import type { UserProfile } from "@cheatcode/types";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { useProfileQuery } from "@/lib/hooks/use-profile";
import { PersonalizationFields } from "./personalization-fields";
import { SettingsHeading } from "./settings-heading";
import { usePersonalizationForm } from "./use-personalization-form";

export function PersonalizationPanel() {
  const profileQuery = useProfileQuery();
  return (
    <div className="text-foreground">
      <SettingsHeading
        description="Name, preferences, and instructions for Cheatcode."
        title="Personalization"
      />
      {profileQuery.data ? (
        <PersonalizationForm profile={profileQuery.data} />
      ) : (
        <PersonalizationLoading />
      )}
    </div>
  );
}

function PersonalizationForm({ profile }: { profile: UserProfile }) {
  const controller = usePersonalizationForm(profile);
  return (
    <div className="flex w-full flex-col gap-6">
      <PersonalizationFields form={controller.form} update={controller.update} />
      <div className="mt-2 flex justify-end">
        <button
          className="inline-flex h-8 items-center justify-center rounded-full bg-foreground px-3 font-medium text-[14px] text-background shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_3px_rgba(0,0,0,0.18)] transition duration-200 hover:bg-foreground/90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={controller.mutation.isPending || !controller.isDirty}
          onClick={controller.save}
          type="button"
        >
          {controller.mutation.isPending ? controller.loader : null}
          {controller.mutation.isSuccess && !controller.isDirty ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}

function PersonalizationLoading() {
  return <CheatcodeLoader className="min-h-[380px]" label="Loading personalization" />;
}
