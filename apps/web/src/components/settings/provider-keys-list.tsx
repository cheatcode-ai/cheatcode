import type { Provider, ProviderKeySummary } from "@cheatcode/types";
import type { FormEventHandler } from "react";
import type { FieldError, UseFormRegister, UseFormWatch } from "react-hook-form";
import { cn } from "@/lib/ui/cn";
import { ProviderKeyEditor } from "./provider-key-editor";
import {
  PROVIDER_META,
  type ProviderKeyEditorStatus,
  type ProviderKeyFormValues,
  providerPanelId,
  providerTabId,
} from "./provider-key-model";

interface ProviderKeysListProps {
  error: FieldError | undefined;
  expandedProvider: Provider | null;
  formProvider: Provider;
  isDeleting: boolean;
  isSaving: boolean;
  isSecretVisible: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onSave: FormEventHandler<HTMLFormElement>;
  onSelect: (provider: Provider) => void;
  onToggleSecret: () => void;
  providers: readonly Provider[];
  register: UseFormRegister<ProviderKeyFormValues>;
  summaries: ProviderKeySummary[];
  watch: UseFormWatch<ProviderKeyFormValues>;
}

export function ProviderKeysList(props: ProviderKeysListProps) {
  const activeSummary = props.summaries.find((summary) => summary.provider === props.formProvider);
  const editorStatus: ProviderKeyEditorStatus = props.isDeleting
    ? "deleting"
    : props.isSaving
      ? "saving"
      : "idle";
  return (
    <div className="text-foreground">
      <section className="scroll-mt-8 rounded-3xl bg-secondary p-1 dark:bg-bg-lifted" id="api-keys">
        <ProviderKeysHeading />
        <div className="mt-2 overflow-hidden rounded-[21px] bg-background ring-1 ring-border/70">
          {props.providers.map((provider, index) => (
            <ProviderKeyRow
              activeSummary={activeSummary}
              editorStatus={editorStatus}
              index={index}
              key={provider}
              props={props}
              provider={provider}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ProviderKeysHeading() {
  return (
    <div className="px-4 py-2">
      <p className="font-medium text-[14px] text-fg-secondary">API Keys</p>
      <p className="mt-2 font-medium text-[14px] text-foreground leading-5">
        Configure model and tool API keys. Your keys are encrypted and decrypted only for the active
        request.
      </p>
    </div>
  );
}

function ProviderKeyRow({
  activeSummary,
  editorStatus,
  index,
  props,
  provider,
}: {
  activeSummary: ProviderKeySummary | undefined;
  editorStatus: ProviderKeyEditorStatus;
  index: number;
  props: ProviderKeysListProps;
  provider: Provider;
}) {
  const summary = props.summaries.find((item) => item.provider === provider);
  const isExpanded = provider === props.expandedProvider;
  return (
    <div className="px-4">
      <div className={cn("py-4", index < props.providers.length - 1 && "border-border border-b")}>
        <ProviderKeyRowHeader
          isExpanded={isExpanded}
          onSelect={props.onSelect}
          provider={provider}
          summary={summary}
        />
        {isExpanded ? (
          <ProviderKeyEditor
            canSave={props.watch("key").trim().length >= 8}
            error={props.error}
            onCancel={props.onCancel}
            onDelete={props.onDelete}
            onSave={props.onSave}
            onToggleSecret={props.onToggleSecret}
            provider={props.formProvider}
            register={props.register}
            secretVisibility={props.isSecretVisible ? "visible" : "hidden"}
            status={editorStatus}
            summary={activeSummary}
          />
        ) : null}
      </div>
    </div>
  );
}

function ProviderKeyRowHeader({
  isExpanded,
  onSelect,
  provider,
  summary,
}: {
  isExpanded: boolean;
  onSelect: (provider: Provider) => void;
  provider: Provider;
  summary: ProviderKeySummary | undefined;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between">
      <h2 className="truncate font-medium text-[14px] text-foreground" id={providerTabId(provider)}>
        {PROVIDER_META[provider].label} API Key
      </h2>
      {isExpanded ? null : (
        <div className="ml-4 flex items-center gap-2">
          <button
            aria-controls={providerPanelId(provider)}
            aria-expanded="false"
            className={cn(
              "inline-flex h-8 items-center justify-center rounded-full px-4 font-medium text-[14px] transition-colors",
              summary
                ? "border border-border bg-background text-foreground hover:bg-secondary"
                : "bg-foreground text-background shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_3px_rgba(0,0,0,0.2)] hover:bg-foreground/90",
            )}
            onClick={() => onSelect(provider)}
            type="button"
          >
            {summary ? "Edit" : "Configure"}
          </button>
        </div>
      )}
    </div>
  );
}
