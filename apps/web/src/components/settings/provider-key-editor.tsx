import type { Provider, ProviderKeySummary } from "@cheatcode/types";
import { Check, Eye, EyeOff, Loader2 } from "@cheatcode/ui";
import type { FormEventHandler } from "react";
import type { FieldError, UseFormRegister } from "react-hook-form";
import {
  PROVIDER_META,
  type ProviderKeyEditorStatus,
  type ProviderKeyFormValues,
  providerPanelId,
  providerTabId,
  type SecretVisibility,
} from "./provider-key-model";

interface ProviderKeyEditorProps {
  canSave: boolean;
  error: FieldError | undefined;
  onCancel: () => void;
  onDelete: () => void;
  onSave: FormEventHandler<HTMLFormElement>;
  onToggleSecret: () => void;
  provider: Provider;
  register: UseFormRegister<ProviderKeyFormValues>;
  secretVisibility: SecretVisibility;
  status: ProviderKeyEditorStatus;
  summary: ProviderKeySummary | undefined;
}

export function ProviderKeyEditor(props: ProviderKeyEditorProps) {
  const inputId = `provider-key-input-${props.provider}`;
  const isDeleting = props.status === "deleting";
  const isSaving = props.status === "saving";
  return (
    <div
      aria-labelledby={providerTabId(props.provider)}
      className="mt-3"
      id={providerPanelId(props.provider)}
      role="tabpanel"
    >
      <form className="space-y-3" onSubmit={props.onSave}>
        <input type="hidden" value={props.provider} {...props.register("provider")} />
        <ProviderKeyInput inputId={inputId} isSaving={isSaving} props={props} />
        {props.error ? (
          <p className="text-red-700 text-xs" id={`${inputId}-error`}>
            {props.error.message}
          </p>
        ) : null}
        <ProviderKeyEditorActions isDeleting={isDeleting} isSaving={isSaving} props={props} />
      </form>
    </div>
  );
}

function ProviderKeyInput({
  inputId,
  isSaving,
  props,
}: {
  inputId: string;
  isSaving: boolean;
  props: ProviderKeyEditorProps;
}) {
  const meta = PROVIDER_META[props.provider];
  const visible = props.secretVisibility === "visible";
  return (
    <div className="relative">
      <input
        aria-label={`Enter your ${meta.label} API Key`}
        aria-invalid={props.error ? "true" : "false"}
        aria-describedby={props.error ? `${inputId}-error` : undefined}
        className="h-8 w-full rounded-full border-0 bg-secondary py-1 pr-10 pl-3 font-mono text-foreground text-xs outline-none ring-2 ring-border ring-offset-2 ring-offset-white transition-shadow placeholder:font-sans placeholder:text-placeholder"
        disabled={isSaving}
        id={inputId}
        placeholder={props.summary ? "••••••••••••••••" : `Enter your ${meta.label} API Key`}
        type={visible ? "text" : "password"}
        {...props.register("key")}
      />
      <button
        aria-label={visible ? "Hide provider key" : "Show provider key"}
        className="absolute top-1/2 right-2.5 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-placeholder transition-colors hover:bg-background hover:text-foreground"
        onClick={props.onToggleSecret}
        type="button"
      >
        {visible ? (
          <EyeOff aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Eye aria-hidden="true" className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

function ProviderKeyEditorActions({
  isDeleting,
  isSaving,
  props,
}: {
  isDeleting: boolean;
  isSaving: boolean;
  props: ProviderKeyEditorProps;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      {props.summary ? (
        <button
          className="inline-flex h-8 items-center justify-center rounded-full px-3 font-medium text-[14px] text-fg-secondary transition-colors hover:bg-secondary hover:text-red-600 disabled:opacity-50"
          disabled={isDeleting || isSaving}
          onClick={props.onDelete}
          type="button"
        >
          {isDeleting ? "Removing..." : "Remove"}
        </button>
      ) : null}
      <button
        className="inline-flex h-8 items-center justify-center rounded-full border border-border bg-background px-3 font-medium text-[14px] text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:bg-secondary disabled:opacity-50"
        disabled={isDeleting || isSaving}
        onClick={props.onCancel}
        type="button"
      >
        Cancel
      </button>
      <button
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-foreground px-3 font-medium text-[14px] text-background shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_3px_rgba(0,0,0,0.2)] transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!props.canSave || isDeleting || isSaving}
        type="submit"
      >
        {isSaving ? (
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : (
          <Check aria-hidden="true" className="h-4 w-4" />
        )}
        Save
      </button>
    </div>
  );
}
