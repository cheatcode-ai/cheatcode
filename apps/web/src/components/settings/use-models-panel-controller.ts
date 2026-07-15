"use client";

import type { Provider, ProviderKeySummary, UserProfile } from "@cheatcode/types";
import { useState } from "react";
import { toast } from "sonner";
import { useProfileQuery, useUpdateProfileMutation } from "@/lib/hooks/use-profile";
import { useProviderKeysQuery } from "@/lib/hooks/use-provider-keys";
import {
  type CatalogModel,
  isModelUsable,
  MODEL_KEY_PROVIDERS,
  type ModelSourceChoice,
  modelAccessState,
  ORDERED_MODELS,
} from "./models-panel-model";

export function useModelsPanelController() {
  const [activeKeyProvider, setActiveKeyProvider] = useState<Provider>("openai");
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const profileQuery = useProfileQuery();
  const keysQuery = useProviderKeysQuery();
  const mutation = useUpdateProfileMutation();
  const disabledModels = profileQuery.data?.disabledModels ?? [];
  const disabledModelIds = new Set(disabledModels);
  const keySummaries = keysQuery.data ?? [];
  const autoKeyProvider = activeModelKeyProvider(keySummaries);
  const enabledUsableCount = countEnabledModels(disabledModelIds, keySummaries, keysQuery);
  const actions = createModelActions({
    disabledModels,
    enabledUsableCount,
    keySummaries,
    keysQuery,
    mutation,
    setActiveKeyProvider,
  });
  return {
    ...actions,
    activeKeyProvider,
    autoKeyProvider,
    disabledModelIds,
    expandedSourceId,
    keySummaries,
    keysQuery,
    mutation,
    profileQuery,
    reload: () => reloadModels(profileQuery, keysQuery),
    setActiveKeyProvider,
    toggleExpanded: (id: string) => setExpandedSourceId((current) => (current === id ? null : id)),
  };
}

function createModelActions(input: {
  disabledModels: UserProfile["disabledModels"];
  enabledUsableCount: number;
  keySummaries: ProviderKeySummary[];
  keysQuery: ReturnType<typeof useProviderKeysQuery>;
  mutation: ReturnType<typeof useUpdateProfileMutation>;
  setActiveKeyProvider: (provider: Provider) => void;
}) {
  function toggleModel(model: CatalogModel, nextEnabled: boolean) {
    const accessState = modelAccessState(
      model,
      input.keySummaries,
      input.keysQuery.isLoading,
      input.keysQuery.isError,
    );
    if (!nextEnabled && isModelUsable(accessState) && input.enabledUsableCount <= 1) {
      toast.error("Keep at least one model enabled.");
      return;
    }
    const next = nextEnabled
      ? input.disabledModels.filter((modelId) => modelId !== model.id)
      : [...input.disabledModels, model.id];
    input.mutation.mutate({ disabledModels: next });
  }
  function focusProviderKey(provider: Provider) {
    input.setActiveKeyProvider(provider);
    requestAnimationFrame(() => {
      document.getElementById("api-keys")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  function selectSourceChoice(choice: ModelSourceChoice) {
    if (choice.unavailableMessage) {
      toast.info(choice.unavailableMessage);
    } else if (choice.provider) {
      focusProviderKey(choice.provider);
    }
  }
  return { focusProviderKey, selectSourceChoice, toggleModel };
}

function activeModelKeyProvider(summaries: ProviderKeySummary[]): Provider | undefined {
  return summaries.find(
    (summary) => summary.disabledAt === null && MODEL_KEY_PROVIDERS.has(summary.provider),
  )?.provider;
}

function countEnabledModels(
  disabledModelIds: Set<string>,
  keySummaries: ProviderKeySummary[],
  keysQuery: ReturnType<typeof useProviderKeysQuery>,
): number {
  return ORDERED_MODELS.filter((model) => {
    const access = modelAccessState(model, keySummaries, keysQuery.isLoading, keysQuery.isError);
    return isModelUsable(access) && !disabledModelIds.has(model.id);
  }).length;
}

function reloadModels(
  profileQuery: ReturnType<typeof useProfileQuery>,
  keysQuery: ReturnType<typeof useProviderKeysQuery>,
) {
  void profileQuery.refetch();
  void keysQuery.refetch();
}
