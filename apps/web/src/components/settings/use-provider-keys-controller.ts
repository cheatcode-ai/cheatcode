"use client";

import type { Provider } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import type { FormEventHandler } from "react";
import { useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { useProviderKeysQuery } from "@/lib/hooks/use-provider-keys";
import { useDeleteProviderKey, useSaveProviderKey } from "./provider-key-api";
import {
  DEFAULT_PROVIDER,
  ProviderKeyFormSchema,
  type ProviderKeyFormValues,
} from "./provider-key-model";

export function useProviderKeysController(
  activeProvider: Provider,
  onActiveProviderChange: (provider: Provider) => void,
) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [expandedProvider, setExpandedProvider] = useState<Provider | null>(null);
  const [isSecretVisible, setSecretVisible] = useState(false);
  const form = useForm<ProviderKeyFormValues>({
    defaultValues: { key: "", provider: DEFAULT_PROVIDER },
    resolver: standardSchemaResolver(ProviderKeyFormSchema),
  });
  const keysQuery = useProviderKeysQuery();
  const saveMutation = useSaveProviderKey(getToken, queryClient);
  const deleteMutation = useDeleteProviderKey(getToken, queryClient);
  const formProvider = expandedProvider ?? activeProvider;
  const actions = createProviderKeyDraftActions({
    deleteMutation,
    expandedProvider,
    form,
    formProvider,
    onActiveProviderChange,
    saveMutation,
    setExpandedProvider,
    setSecretVisible,
  });
  return {
    ...actions,
    expandedProvider,
    form,
    formProvider,
    isDeleting: deleteMutation.isPending && deleteMutation.variables === formProvider,
    isSaving: saveMutation.isPending && saveMutation.variables?.provider === formProvider,
    isSecretVisible,
    summaries: keysQuery.data ?? [],
  };
}

function createProviderKeyDraftActions(input: {
  deleteMutation: ReturnType<typeof useDeleteProviderKey>;
  expandedProvider: Provider | null;
  form: ReturnType<typeof useForm<ProviderKeyFormValues>>;
  formProvider: Provider;
  onActiveProviderChange: (provider: Provider) => void;
  saveMutation: ReturnType<typeof useSaveProviderKey>;
  setExpandedProvider: (
    value: Provider | null | ((current: Provider | null) => Provider | null),
  ) => void;
  setSecretVisible: (value: boolean | ((current: boolean) => boolean)) => void;
}) {
  function resetDraft(provider: Provider) {
    input.setSecretVisible(false);
    input.form.reset({ key: "", provider });
  }
  function selectProvider(provider: Provider) {
    resetDraft(provider);
    input.setExpandedProvider((current) => (current === provider ? null : provider));
    input.onActiveProviderChange(provider);
  }
  function closeEditor() {
    resetDraft(input.expandedProvider ?? input.formProvider);
    input.setExpandedProvider(null);
  }
  const saveDraft: SubmitHandler<ProviderKeyFormValues> = (values) => {
    input.setSecretVisible(false);
    input.saveMutation.mutate(values, {
      onSuccess: () => {
        input.form.reset({ key: "", provider: values.provider });
        input.setExpandedProvider(null);
      },
    });
  };
  const submitDraft: FormEventHandler<HTMLFormElement> = (event) => {
    void input.form.handleSubmit(saveDraft)(event);
  };
  function deleteDraft() {
    input.deleteMutation.mutate(input.formProvider, {
      onSuccess: () => input.setExpandedProvider(null),
    });
  }
  return {
    closeEditor,
    deleteDraft,
    selectProvider,
    submitDraft,
    toggleSecret: () => input.setSecretVisible((current) => !current),
  };
}
