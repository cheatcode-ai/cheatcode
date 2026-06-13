"use client";

import {
  type Provider,
  type ProviderKeySummary,
  ProviderKeySummarySchema,
  ProviderSchema,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { cn } from "@/lib/ui/cn";

type ProviderMeta = {
  description: string;
  keyUrl: string;
  keyUrlLabel: string;
  label: string;
  placeholder: string;
};

const PROVIDERS = ProviderSchema.options;
const PROVIDER_KEYS_QUERY = ["provider-keys"] as const;
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
  elevenlabs: {
    description: "Voice generation and speech APIs for media workflows.",
    keyUrl: "https://elevenlabs.io/app/settings/api-keys",
    keyUrlLabel: "elevenlabs.io",
    label: "ElevenLabs",
    placeholder: "sk_...",
  },
  exa: {
    description: "Search and research retrieval for web-grounded agent work.",
    keyUrl: "https://dashboard.exa.ai/api-keys",
    keyUrlLabel: "dashboard.exa.ai",
    label: "Exa",
    placeholder: "exa_...",
  },
  fal: {
    description: "Image, video, and media generation provider access.",
    keyUrl: "https://fal.ai/dashboard/keys",
    keyUrlLabel: "fal.ai",
    label: "Fal",
    placeholder: "fal_...",
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

export function ProviderKeysPanel() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [activeProvider, setActiveProvider] = useState<Provider>(DEFAULT_PROVIDER);
  const [secretVisible, setSecretVisible] = useState(false);
  const form = useForm<ProviderKeyFormValues>({
    defaultValues: { key: "", provider: DEFAULT_PROVIDER },
    resolver: zodResolver(ProviderKeyFormSchema),
  });
  const keysQuery = useProviderKeysQuery(getToken);
  const saveMutation = useSaveProviderKey(getToken, queryClient);
  const deleteMutation = useDeleteProviderKey(getToken, queryClient);
  const summaries = keysQuery.data ?? [];
  const activeSummary = summaries.find((summary) => summary.provider === activeProvider);

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

  return (
    <div className="flex flex-col items-center text-zinc-200">
      <div className="mb-10 max-w-xl space-y-6 text-center">
        <h1 className="font-medium text-2xl text-white tracking-tight">API Keys</h1>
        <p className="text-sm text-zinc-500 leading-relaxed">
          Connect your own provider keys. Keys are encrypted, vault-backed, and only used by
          server-side V2 workers.
        </p>
      </div>
      <ProviderTabs
        activeProvider={activeProvider}
        onSelect={(provider) => {
          setActiveProvider(provider);
          setSecretVisible(false);
          form.reset({ key: "", provider });
        }}
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
    </div>
  );
}

function ProviderTabs({
  activeProvider,
  onSelect,
  summaries,
}: {
  activeProvider: Provider;
  onSelect: (provider: Provider) => void;
  summaries: ProviderKeySummary[];
}) {
  return (
    <div
      aria-label="Provider key settings"
      aria-orientation="horizontal"
      className="mb-8 flex w-full max-w-4xl flex-wrap items-center justify-center gap-1 rounded-3xl border border-zinc-800/80 bg-[#111] p-1.5 shadow-xl"
      role="tablist"
    >
      {PROVIDERS.map((provider) => {
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
              "relative z-10 flex h-10 min-w-32 shrink-0 items-center justify-center gap-2 rounded-full px-5 font-medium text-sm transition-colors",
              isActive ? "bg-white text-black" : "text-zinc-500 hover:text-zinc-300",
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
    <div aria-labelledby={tabId} className="w-full max-w-lg space-y-6" id={panelId} role="tabpanel">
      <form
        className="space-y-6 rounded-3xl border border-zinc-800/80 bg-[#111] p-8 shadow-xl"
        onSubmit={onSave}
      >
        <input type="hidden" value={provider} {...register("provider")} />
        <h2
          className="text-center font-mono text-[10px] text-zinc-600 uppercase tracking-[0.24em]"
          id={`${inputId}-label`}
        >
          {meta.label}
        </h2>
        <p className="pb-2 text-center text-sm text-zinc-500 leading-relaxed">{meta.description}</p>
        <div className="group relative">
          <input
            aria-labelledby={`${inputId}-label`}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? `${inputId}-error` : undefined}
            className="h-14 w-full rounded-2xl border border-zinc-800/80 bg-[#0a0a0a] pr-12 pl-6 font-mono text-lg text-white shadow-inner outline-none transition-colors placeholder:text-zinc-700 focus:border-zinc-600"
            disabled={isSaving}
            id={inputId}
            placeholder={meta.placeholder}
            type={isSecretVisible ? "text" : "password"}
            {...register("key")}
          />
          <button
            aria-label={isSecretVisible ? "Hide provider key" : "Show provider key"}
            className="absolute top-1/2 right-4 -translate-y-1/2 text-zinc-600 transition-colors hover:text-zinc-400"
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
          <p className="text-center text-red-300 text-xs" id={`${inputId}-error`}>
            {error.message}
          </p>
        ) : null}
        <button
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-white font-medium text-base text-black shadow-lg transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={isSaving}
          type="submit"
        >
          {isSaving ? <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" /> : "Connect"}
        </button>
        <p className="pt-2 text-center text-xs text-zinc-600">
          Your key is encrypted and stored securely.
        </p>
      </form>
      <ProviderKeyLink meta={meta} />
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
    <div aria-labelledby={tabId} className="w-full max-w-lg space-y-6" id={panelId} role="tabpanel">
      <section className="space-y-6 rounded-3xl border border-zinc-800/80 bg-[#111] p-8 text-center shadow-xl">
        <div
          className={cn(
            "mx-auto flex h-16 w-16 items-center justify-center rounded-full ring-4",
            keyIconClass(isDisabled),
          )}
        >
          <Check aria-hidden="true" className="h-8 w-8" />
        </div>
        <div className="space-y-2">
          <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-[0.24em]">
            {meta.label}
          </p>
          <div className="flex items-center justify-center gap-2">
            <h2 className="font-medium text-white">Connected</h2>
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px]",
                keyBadgeClass(isDisabled),
              )}
            >
              {isDisabled ? "Disabled" : "Active"}
            </span>
          </div>
          <p className="font-mono text-sm text-zinc-500">{summary.fingerprint}</p>
          {isDisabled ? (
            <p className="text-amber-200/70 text-xs">
              Disabled by your current plan's provider key slot limit.
            </p>
          ) : null}
          {summary.lastUsedAt ? (
            <p className="text-xs text-zinc-600">Last used {formatTimeAgo(summary.lastUsedAt)}</p>
          ) : null}
          <p className="pt-2 text-sm text-zinc-500">
            Your {meta.label} key is encrypted and active.
          </p>
        </div>
        <button
          className="inline-flex h-10 items-center justify-center rounded-xl px-6 text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
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
      </section>
      <ProviderKeyLink meta={meta} />
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
    <p className="text-center text-xs text-zinc-600">
      <a
        className="inline-flex items-center gap-1 text-zinc-400 underline transition-colors hover:text-white"
        href={meta.keyUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        Manage keys on {meta.keyUrlLabel}
        <ExternalLink aria-hidden="true" className="h-3 w-3" />
      </a>
    </p>
  );
}

function useProviderKeysQuery(getToken: () => Promise<null | string>) {
  return useQuery({
    queryFn: async () => {
      const response = await authorizedFetch(getToken, "/v1/provider-keys");
      return ProviderKeySummarySchema.array().parse(await response.json());
    },
    queryKey: PROVIDER_KEYS_QUERY,
    staleTime: 30_000,
  });
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
