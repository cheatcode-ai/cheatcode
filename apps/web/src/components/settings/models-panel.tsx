"use client";

import { Brain } from "@cheatcode/ui";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { ModelsCatalog } from "./models-panel-list";
import { SETTINGS_KEY_PROVIDERS } from "./models-panel-model";
import { ProviderKeysPanel } from "./provider-keys-panel";
import { SettingsHeading } from "./settings-heading";
import { useModelsPanelController } from "./use-models-panel-controller";

export function ModelsPanel() {
  const controller = useModelsPanelController();
  return (
    <div className="text-foreground">
      <SettingsHeading
        description="Choose which models appear in Cheatcode, review availability, and connect your API keys."
        title="Models"
      />
      <section className="rounded-3xl bg-secondary p-1 dark:bg-bg-lifted">
        <div className="flex items-center px-4 pt-2 pb-3">
          <span className="font-medium text-[14px] text-fg-secondary leading-5">Agent Models</span>
        </div>
        <ModelsCatalog controller={controller} />
        <ModelsLoadError controller={controller} />
      </section>
      <div className="mt-6">
        <ProviderKeysPanel
          activeProvider={controller.activeKeyProvider}
          onActiveProviderChange={controller.setActiveKeyProvider}
          providers={SETTINGS_KEY_PROVIDERS}
        />
      </div>
    </div>
  );
}

function ModelsLoadError({
  controller,
}: {
  controller: ReturnType<typeof useModelsPanelController>;
}) {
  if (!controller.profileQuery.isError && !controller.keysQuery.isError) {
    return null;
  }
  return (
    <RecoveryCard
      action={{
        isPending: controller.profileQuery.isFetching || controller.keysQuery.isFetching,
        label: "Reload",
        onClick: controller.reload,
        pendingLabel: "Reloading…",
      }}
      className="mt-1"
      description="We couldn't sync your preferences or key status. Reload to try again."
      icon={Brain}
      title="Model settings are unavailable"
      variant="inline"
    />
  );
}
