"use client";

import {
  type Provider,
  type ProviderKeySummary,
  ProviderKeySummarySchema,
  ProviderSchema,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEventHandler } from "react";
import { useState } from "react";
import {
  type FieldError,
  type SubmitHandler,
  type UseFormRegister,
  useForm,
} from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Check, ExternalLink, Eye, EyeOff, Loader2, Trash2 } from "@/components/ui/icons";
import { authorizedFetch } from "@/lib/api/authorized-fetch";
import { PROVIDER_KEYS_QUERY, useProviderKeysQuery } from "@/lib/hooks/use-provider-keys";
import { cn } from "@/lib/ui/cn";
import { SettingsHeading } from "./settings-heading";

type ProviderMeta = {
  description: string;
  keyUrl: string;
  keyUrlLabel: string;
  label: string;
  placeholder: string;
};
type ProviderKeysPanelVariant = "compact" | "tabs";

const PROVIDERS = ProviderSchema.options;
const DEFAULT_PROVIDER: Provider = "anthropic";
const ProviderKeyFormSchema = z
  .object({
    key: z.string().trim().min(8, "Enter a provider key").max(4096),
    provider: ProviderSchema,
  })
  .strict();
type ProviderKeyFormValues = z.infer<typeof ProviderKeyFormSchema>;
const PROVIDER_META: Record<Provider, ProviderMeta> = {
  anthropic: {
    description: "Direct access to Claude models from Anthropic.",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyUrlLabel: "console.anthropic.com",
    label: "Anthropic",
    placeholder: "sk-ant-...",
  },
  deepseek: {
    description: "Your own DeepSeek key - runs beyond the free 200K token allowance.",
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyUrlLabel: "platform.deepseek.com",
    label: "DeepSeek",
    placeholder: "sk-...",
  },
  exa: {
    description: "Search and research retrieval for web-grounded agent work.",
    keyUrl: "https://dashboard.exa.ai/api-keys",
    keyUrlLabel: "dashboard.exa.ai",
    label: "Exa",
    placeholder: "exa_...",
  },
  firecrawl: {
    description: "Web search, crawl, scrape, and page extraction workflows.",
    keyUrl: "https://www.firecrawl.dev/app/api-keys",
    keyUrlLabel: "firecrawl.dev",
    label: "Firecrawl",
    placeholder: "fc-...",
  },
  google: {
    description: "Direct access to Gemini models from Google AI Studio.",
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyUrlLabel: "aistudio.google.com",
    label: "Gemini",
    placeholder: "AIza...",
  },
  llamaparse: {
    description: "Document parsing for PDFs and structured file extraction.",
    keyUrl: "https://cloud.llamaindex.ai/api-key",
    keyUrlLabel: "cloud.llamaindex.ai",
    label: "LlamaParse",
    placeholder: "llx-...",
  },
  openai: {
    description: "Direct access to OpenAI models and multimodal APIs.",
    keyUrl: "https://platform.openai.com/api-keys",
    keyUrlLabel: "platform.openai.com",
    label: "OpenAI",
    placeholder: "sk-...",
  },
  openrouter: {
    description: "Access many models from major providers through one API.",
    keyUrl: "https://openrouter.ai/keys",
    keyUrlLabel: "openrouter.ai/keys",
    label: "OpenRouter",
    placeholder: "sk-or-v1-...",
  },
};

export function ProviderKeysPanel({
  activeProvider: controlledActiveProvider,
  onActiveProviderChange,
  providers = PROVIDERS,
  showHeading = true,
  variant = "tabs",
}: {
  activeProvider?: Provider;
  onActiveProviderChange?: (provider: Provider) => void;
  providers?: readonly Provider[];
  showHeading?: boolean;
  variant?: ProviderKeysPanelVariant;
}) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [uncontrolledActiveProvider, setUncontrolledActiveProvider] =
    useState<Provider>(DEFAULT_PROVIDER);
  const [compactExpandedProvider, setCompactExpandedProvider] = useState<Provider | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const activeProvider = controlledActiveProvider ?? uncontrolledActiveProvider;
  const form = useForm<ProviderKeyFormValues>({
    defaultValues: { key: "", provider: DEFAULT_PROVIDER },
    resolver: zodResolver(ProviderKeyFormSchema),
  });
  const keysQuery = useProviderKeysQuery();
  const saveMutation = useSaveProviderKey(getToken, queryClient);
  const deleteMutation = useDeleteProviderKey(getToken, queryClient);
  const summaries = keysQuery.data ?? [];
  const activeSummary = summaries.find((summary) => summary.provider === activeProvider);

  function resetProviderDraft(provider: Provider) {
    setSecretVisible(false);
    form.reset({ key: "", provider });
  }

  function selectProvider(provider: Provider) {
    resetProviderDraft(provider);
    if (onActiveProviderChange) {
      onActiveProviderChange(provider);
      return;
    }
    setUncontrolledActiveProvider(provider);
  }

  function selectCompactProvider(provider: Provider) {
    resetProviderDraft(provider);
    setCompactExpandedProvider((current) => (current === provider ? null : provider));
    if (onActiveProviderChange) {
      onActiveProviderChange(provider);
      return;
    }
    setUncontrolledActiveProvider(provider);
  }

  const saveDraft: SubmitHandler<ProviderKeyFormValues> = (values) => {
    setSecretVisible(false);
    saveMutation.mutate(
      { key: values.key, provider: values.provider },
      { onSuccess: () => form.reset({ key: "", provider: values.provider }) },
    );
  };
  const handleProviderKeySubmit: FormEventHandler<HTMLFormElement> = (event) => {
    void form.handleSubmit(saveDraft)(event);
  };

  if (variant === "compact") {
    const compactProvider = compactExpandedProvider ?? activeProvider;
    return (
      <CompactProviderKeysPanel
        expandedProvider={compactExpandedProvider}
        error={form.formState.errors.key}
        formProvider={compactProvider}
        isDeleting={deleteMutation.isPending && deleteMutation.variables === compactProvider}
        isSaving={saveMutation.isPending && saveMutation.variables?.provider === compactProvider}
        isSecretVisible={secretVisible}
        onDelete={() => deleteMutation.mutate(compactProvider)}
        onSave={handleProviderKeySubmit}
        onSelect={selectCompactProvider}
        onToggleSecret={() => setSecretVisible((current) => !current)}
        providers={providers}
        register={form.register}
        showHeading={showHeading}
        summaries={summaries}
      />
    );
  }

  return (
    <div className="text-[#1b1b1b]">
      {showHeading ? (
        <SettingsHeading
          description="Bring your own keys. Encrypted in Vault, decrypted per request, never logged."
          title="API keys"
        />
      ) : null}
      <section
        className="scroll-mt-8 overflow-hidden rounded-[24px] border border-[#eeeeee] bg-white shadow-[0_18px_45px_rgba(15,15,15,0.035)]"
        id="api-keys"
      >
        {showHeading ? null : (
          <div className="px-5 pt-5 pb-3">
            <p className="text-[#707070] text-[14px]">API keys</p>
            <p className="mt-1 font-medium text-[#1b1b1b] text-[14px]">
              Bring your own keys. Encrypted in Vault, decrypted per request, never logged.
            </p>
          </div>
        )}
        <ProviderTabs
          activeProvider={activeProvider}
          onSelect={selectProvider}
          providers={providers}
          summaries={summaries}
        />
        <ProviderKeyCard
          error={form.formState.errors.key}
          isDeleting={deleteMutation.isPending && deleteMutation.variables === activeProvider}
          isSaving={saveMutation.isPending && saveMutation.variables?.provider === activeProvider}
          isSecretVisible={secretVisible}
          onDelete={() => deleteMutation.mutate(activeProvider)}
          onSave={handleProviderKeySubmit}
          onToggleSecret={() => setSecretVisible((current) => !current)}
          provider={activeProvider}
          register={form.register}
          summary={activeSummary}
        />
      </section>
    </div>
  );
}

function CompactProviderKeysPanel({
  expandedProvider,
  error,
  formProvider,
  isDeleting,
  isSaving,
  isSecretVisible,
  onDelete,
  onSave,
  onSelect,
  onToggleSecret,
  providers,
  register,
  showHeading,
  summaries,
}: {
  expandedProvider: Provider | null;
  error: FieldError | undefined;
  formProvider: Provider;
  isDeleting: boolean;
  isSaving: boolean;
  isSecretVisible: boolean;
  onDelete: () => void;
  onSave: FormEventHandler<HTMLFormElement>;
  onSelect: (provider: Provider) => void;
  onToggleSecret: () => void;
  providers: readonly Provider[];
  register: UseFormRegister<ProviderKeyFormValues>;
  showHeading: boolean;
  summaries: ProviderKeySummary[];
}) {
  const activeSummary = summaries.find((summary) => summary.provider === formProvider);
  return (
    <div className="text-[#1b1b1b]">
      {showHeading ? (
        <SettingsHeading
          description="Configure your own API keys to use AI models at cost. Your keys are encrypted and stored securely."
          title="API keys"
        />
      ) : null}
      <section className="scroll-mt-8 rounded-3xl bg-[#f7f7f7] p-1" id="api-keys">
        <div className="px-4 py-2">
          <p className="font-medium text-[#707070] text-[14px]">API Keys</p>
          <p className="mt-2 font-medium text-[#1b1b1b] text-[14px] leading-5">
            Configure your own API keys to use AI models at cost. Your keys are encrypted and stored
            securely.
          </p>
        </div>
        <div className="mt-2 overflow-hidden rounded-[21px] bg-white ring-1 ring-[#f1f1f1]/70">
          {providers.map((provider) => {
            const summary = summaries.find((item) => item.provider === provider);
            const isExpanded = provider === expandedProvider;
            return (
              <div className="border-[#f7f7f7] border-t first:border-t-0" key={provider}>
                <div className="flex min-h-16 items-center justify-between gap-3 px-4 py-4">
                  <div className="min-w-0">
                    <h2
                      className="truncate font-medium text-[#1b1b1b] text-[14px]"
                      id={providerTabId(provider)}
                    >
                      {PROVIDER_META[provider].label} API Key
                    </h2>
                    {summary ? (
                      <p className="mt-0.5 truncate font-mono text-[#8a8a8a] text-[12px]">
                        {summary.disabledAt === null ? "Connected" : "Disabled"} ·{" "}
                        {summary.fingerprint}
                      </p>
                    ) : null}
                  </div>
                  <button
                    aria-controls={providerPanelId(provider)}
                    aria-expanded={isExpanded}
                    className={cn(
                      "inline-flex h-8 items-center justify-center rounded-full px-4 font-medium text-[14px] transition-colors",
                      summary
                        ? "border border-[#e6e6e6] bg-white text-[#1b1b1b] hover:bg-[#f7f7f7]"
                        : "bg-[#1b1b1b] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_3px_rgba(0,0,0,0.2)] hover:bg-black",
                    )}
                    onClick={() => onSelect(provider)}
                    type="button"
                  >
                    {summary ? "Edit" : "Configure"}
                  </button>
                </div>
                {isExpanded ? (
                  <ProviderKeyCard
                    error={error}
                    isDeleting={isDeleting}
                    isSaving={isSaving}
                    isSecretVisible={isSecretVisible}
                    onDelete={onDelete}
                    onSave={onSave}
                    onToggleSecret={onToggleSecret}
                    provider={formProvider}
                    register={register}
                    summary={activeSummary}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ProviderTabs({
  activeProvider,
  onSelect,
  providers,
  summaries,
}: {
  activeProvider: Provider;
  onSelect: (provider: Provider) => void;
  providers: readonly Provider[];
  summaries: ProviderKeySummary[];
}) {
  return (
    <div
      aria-label="Provider key settings"
      aria-orientation="horizontal"
      className="mx-4 mb-4 flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[#f1f1f1] bg-[#f8f8f8] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
    >
      {providers.map((provider) => {
        const isActive = provider === activeProvider;
        const summary = summaries.find((keySummary) => keySummary.provider === provider);
        const hasKey = summary !== undefined;
        const isDisabled = summary?.disabledAt !== null && summary?.disabledAt !== undefined;
        const panelId = providerPanelId(provider);
        const tabId = providerTabId(provider);
        return (
          <button
            aria-controls={panelId}
            aria-label={`${PROVIDER_META[provider].label} provider key settings`}
            aria-selected={isActive}
            className={cn(
              "relative z-10 flex h-8 min-w-fit shrink-0 items-center justify-center gap-2 rounded-full px-3.5 font-medium text-[13px] transition-colors",
              isActive
                ? "bg-white text-[#1b1b1b] shadow-[0_1px_2px_rgba(15,15,15,0.07)]"
                : "text-[#707070] hover:bg-white/70 hover:text-[#1b1b1b]",
            )}
            id={tabId}
            key={provider}
            onClick={() => onSelect(provider)}
            role="tab"
            type="button"
          >
            <span className="truncate">{PROVIDER_META[provider].label}</span>
            {hasKey ? (
              <span
                aria-hidden="true"
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  providerStatusDotClass(isActive, isDisabled),
                )}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ProviderKeyCard({
  error,
  isDeleting,
  isSaving,
  isSecretVisible,
  onDelete,
  onSave,
  onToggleSecret,
  provider,
  register,
  summary,
}: {
  error: FieldError | undefined;
  isDeleting: boolean;
  isSaving: boolean;
  isSecretVisible: boolean;
  onDelete: () => void;
  onSave: FormEventHandler<HTMLFormElement>;
  onToggleSecret: () => void;
  provider: Provider;
  register: UseFormRegister<ProviderKeyFormValues>;
  summary: ProviderKeySummary | undefined;
}) {
  const meta = PROVIDER_META[provider];
  const panelId = providerPanelId(provider);
  const tabId = providerTabId(provider);
  const inputId = `provider-key-input-${provider}`;

  if (summary) {
    return (
      <ConnectedProviderKeyCard
        isDeleting={isDeleting}
        meta={meta}
        onDelete={onDelete}
        panelId={panelId}
        summary={summary}
        tabId={tabId}
      />
    );
  }

  return (
    <div aria-labelledby={tabId} className="w-full px-5 pb-5" id={panelId} role="tabpanel">
      <form
        className="space-y-4 rounded-[20px] border border-[#f1f1f1] bg-[#fbfbfb] p-4"
        onSubmit={onSave}
      >
        <input type="hidden" value={provider} {...register("provider")} />
        <div className="space-y-2">
          <h2 className="font-semibold text-[#1b1b1b] text-[15px]" id={`${inputId}-label`}>
            {meta.label}
          </h2>
          <p className="text-[#707070] text-[14px] leading-relaxed">{meta.description}</p>
        </div>
        <div className="group relative">
          <input
            aria-labelledby={`${inputId}-label`}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? `${inputId}-error` : undefined}
            className="h-10 w-full rounded-full border border-[#eeeeee] bg-white pr-12 pl-4 font-mono text-[#1b1b1b] text-[13px] outline-none transition-colors placeholder:text-[#a0a0a0] focus:border-[#d8d8d8]"
            disabled={isSaving}
            id={inputId}
            placeholder={meta.placeholder}
            type={isSecretVisible ? "text" : "password"}
            {...register("key")}
          />
          <button
            aria-label={isSecretVisible ? "Hide provider key" : "Show provider key"}
            className="absolute top-1/2 right-4 -translate-y-1/2 text-[#8a8a8a] transition-colors hover:text-[#1b1b1b]"
            onClick={onToggleSecret}
            type="button"
          >
            {isSecretVisible ? (
              <EyeOff aria-hidden="true" className="h-5 w-5" />
            ) : (
              <Eye aria-hidden="true" className="h-5 w-5" />
            )}
          </button>
        </div>
        {error ? (
          <p className="text-red-700 text-xs" id={`${inputId}-error`}>
            {error.message}
          </p>
        ) : null}
        <button
          className="flex h-10 w-full items-center justify-center rounded-full bg-[#1b1b1b] font-medium text-[14px] text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-45"
          disabled={isSaving}
          type="submit"
        >
          {isSaving ? <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" /> : "Connect"}
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[#707070] text-xs">
          <p>Your key is encrypted and stored securely.</p>
          <ProviderKeyLink meta={meta} />
        </div>
      </form>
    </div>
  );
}

function ConnectedProviderKeyCard({
  isDeleting,
  meta,
  onDelete,
  panelId,
  summary,
  tabId,
}: {
  isDeleting: boolean;
  meta: ProviderMeta;
  onDelete: () => void;
  panelId: string;
  summary: ProviderKeySummary;
  tabId: string;
}) {
  const isDisabled = summary.disabledAt !== null;
  return (
    <div aria-labelledby={tabId} className="w-full px-5 pb-5" id={panelId} role="tabpanel">
      <section className="space-y-5 rounded-[20px] border border-[#f1f1f1] bg-[#fbfbfb] p-4">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full ring-4",
            keyIconClass(isDisabled),
          )}
        >
          <Check aria-hidden="true" className="h-5 w-5" />
        </div>
        <div className="space-y-2">
          <p className="font-semibold text-[#1b1b1b] text-[15px]">{meta.label}</p>
          <div className="flex items-center gap-2">
            <h2 className="font-medium text-[#1b1b1b]">Connected</h2>
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px]",
                keyBadgeClass(isDisabled),
              )}
            >
              {isDisabled ? "Disabled" : "Active"}
            </span>
          </div>
          <p className="font-mono text-[#707070] text-sm">{summary.fingerprint}</p>
          {isDisabled ? (
            <p className="text-amber-700 text-xs">
              Disabled by your current plan's provider key slot limit.
            </p>
          ) : null}
          {summary.lastUsedAt ? (
            <p className="text-[#8a8a8a] text-xs">Last used {formatTimeAgo(summary.lastUsedAt)}</p>
          ) : null}
          <p className="pt-2 text-[#707070] text-sm">
            Your {meta.label} key is encrypted and active.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ProviderKeyLink meta={meta} />
          <button
            className="inline-flex h-9 items-center justify-center rounded-full px-4 text-red-700 text-sm transition-colors hover:bg-red-50 disabled:opacity-50"
            disabled={isDeleting}
            onClick={onDelete}
            type="button"
          >
            {isDeleting ? (
              <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />
            )}
            {isDeleting ? "Removing..." : "Disconnect"}
          </button>
        </div>
      </section>
    </div>
  );
}

function providerStatusDotClass(isActive: boolean, isDisabled: boolean): string {
  if (isDisabled) {
    return isActive ? "bg-amber-600" : "bg-amber-500";
  }
  return isActive ? "bg-emerald-600" : "bg-emerald-500";
}

function keyIconClass(isDisabled: boolean): string {
  return isDisabled
    ? "bg-amber-500/10 text-amber-400 ring-amber-500/5"
    : "bg-emerald-500/10 text-emerald-500 ring-emerald-500/5";
}

function keyBadgeClass(isDisabled: boolean): string {
  return isDisabled
    ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
    : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";
}

function providerPanelId(provider: Provider): string {
  return `provider-key-panel-${provider}`;
}

function providerTabId(provider: Provider): string {
  return `provider-key-tab-${provider}`;
}

function ProviderKeyLink({ meta }: { meta: ProviderMeta }) {
  return (
    <a
      className="inline-flex items-center gap-1 text-[#707070] underline transition-colors hover:text-[#1b1b1b]"
      href={meta.keyUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      Manage keys on {meta.keyUrlLabel}
      <ExternalLink aria-hidden="true" className="h-3 w-3" />
    </a>
  );
}

function useSaveProviderKey(
  getToken: () => Promise<null | string>,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return useMutation({
    mutationFn: (input: { key: string; provider: Provider }) =>
      saveProviderKey(getToken, input.provider, input.key),
    onError: (error) => toast.error(error.message),
    onSuccess: (summary) => {
      queryClient.setQueryData<ProviderKeySummary[]>(PROVIDER_KEYS_QUERY, (current) =>
        upsertSummary(current ?? [], summary),
      );
      toast.success("Provider key saved");
    },
  });
}

function useDeleteProviderKey(
  getToken: () => Promise<null | string>,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return useMutation({
    mutationFn: (provider: Provider) => deleteProviderKeyRequest(getToken, provider),
    onError: (error) => toast.error(error.message),
    onSuccess: (_result, provider) => {
      queryClient.setQueryData<ProviderKeySummary[]>(PROVIDER_KEYS_QUERY, (current) =>
        (current ?? []).filter((summary) => summary.provider !== provider),
      );
      toast.success("Provider key deleted");
    },
  });
}

async function saveProviderKey(
  getToken: () => Promise<null | string>,
  provider: Provider,
  key: string,
): Promise<ProviderKeySummary> {
  const response = await authorizedFetch(getToken, "/v1/provider-keys", {
    body: JSON.stringify({ key, provider }),
    method: "POST",
  });
  return ProviderKeySummarySchema.parse(await response.json());
}

async function deleteProviderKeyRequest(
  getToken: () => Promise<null | string>,
  provider: Provider,
): Promise<void> {
  await authorizedFetch(getToken, `/v1/provider-keys/${provider}`, { method: "DELETE" });
}

function upsertSummary(
  current: ProviderKeySummary[],
  summary: ProviderKeySummary,
): ProviderKeySummary[] {
  const rest = current.filter((item) => item.provider !== summary.provider);
  return [...rest, summary].sort((left, right) => left.provider.localeCompare(right.provider));
}

function formatTimeAgo(value: string): string {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) {
    return "just now";
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 30) {
    return `${diffDays}d ago`;
  }
  return date.toLocaleDateString();
}
