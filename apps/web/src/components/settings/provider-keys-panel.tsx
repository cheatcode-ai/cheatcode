"use client";

import type { Provider } from "@cheatcode/types";
import { ProviderKeysList } from "./provider-keys-list";
import { useProviderKeysController } from "./use-provider-keys-controller";

export function ProviderKeysPanel({
  activeProvider,
  onActiveProviderChange,
  providers,
}: {
  activeProvider: Provider;
  onActiveProviderChange: (provider: Provider) => void;
  providers: readonly Provider[];
}) {
  const controller = useProviderKeysController(activeProvider, onActiveProviderChange);
  return (
    <ProviderKeysList
      error={controller.form.formState.errors.key}
      expandedProvider={controller.expandedProvider}
      formProvider={controller.formProvider}
      isDeleting={controller.isDeleting}
      isSaving={controller.isSaving}
      isSecretVisible={controller.isSecretVisible}
      onCancel={controller.closeEditor}
      onDelete={controller.deleteDraft}
      onSave={controller.submitDraft}
      onSelect={controller.selectProvider}
      onToggleSecret={controller.toggleSecret}
      providers={providers}
      register={controller.form.register}
      summaries={controller.summaries}
      watch={controller.form.watch}
    />
  );
}
