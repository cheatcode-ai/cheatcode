"use client";

import type { BillingCancellationReason } from "@cheatcode/types";
import { formatPeriodEnd } from "@/components/billing/use-manage-subscription";
import { ChevronDown, Loader2 } from "@/components/ui";

const CANCELLATION_REASON_LABELS: Record<BillingCancellationReason, string> = {
  customer_service: "Customer service",
  low_quality: "Quality didn't meet my needs",
  missing_features: "Missing features",
  other: "Something else",
  switched_service: "Switched to another service",
  too_complex: "Too difficult to use",
  too_expensive: "Too expensive",
  unused: "I don't use it enough",
};

interface SubscriptionCancellationFormProps {
  comment: string;
  isBusy: boolean;
  onBack: () => void;
  onCommentChange: (value: string) => void;
  onConfirm: () => void;
  onReasonChange: (value: BillingCancellationReason | "") => void;
  periodEnd: string | null;
  planDisplayName: string;
  reason: BillingCancellationReason | "";
}

export function SubscriptionCancellationForm({
  comment,
  isBusy,
  onBack,
  onCommentChange,
  onConfirm,
  onReasonChange,
  periodEnd,
  planDisplayName,
  reason,
}: SubscriptionCancellationFormProps) {
  return (
    <div className="mt-5">
      <h3 className="font-semibold text-[16px]">Cancel {planDisplayName}?</h3>
      <p className="mt-1.5 text-[13px] text-fg-secondary leading-5">
        Your plan stays active until {formatPeriodEnd(periodEnd)}. You won't be charged again after
        that date.
      </p>
      <div className="mt-5 space-y-4">
        <CancellationReasonField disabled={isBusy} onChange={onReasonChange} value={reason} />
        <CancellationCommentField disabled={isBusy} onChange={onCommentChange} value={comment} />
      </div>
      <CancellationActions isBusy={isBusy} onBack={onBack} onConfirm={onConfirm} />
    </div>
  );
}

function CancellationReasonField({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: BillingCancellationReason | "") => void;
  value: BillingCancellationReason | "";
}) {
  return (
    <label className="block">
      <span className="font-medium text-[13px] text-fg-secondary">Why are you cancelling?</span>
      <span className="relative mt-2 block min-w-0 max-w-full">
        <select
          className="block h-11 w-full min-w-0 appearance-none rounded-[14px] border border-border bg-background py-0 pr-10 pl-3 text-[14px] outline-none disabled:cursor-not-allowed disabled:bg-bg-secondary disabled:text-placeholder"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as BillingCancellationReason | "")}
          value={value}
        >
          <option value="">Select a reason (optional)</option>
          {Object.entries(CANCELLATION_REASON_LABELS).map(([reason, label]) => (
            <option key={reason} value={reason}>
              {label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-secondary"
        />
      </span>
    </label>
  );
}

function CancellationCommentField({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-3 font-medium text-[13px] text-fg-secondary">
        Anything else?
        <span className="font-normal text-placeholder">Optional</span>
      </span>
      <textarea
        className="mt-2 min-h-24 w-full resize-y rounded-[14px] border border-border bg-background px-3 py-2.5 text-[14px] leading-5 outline-none placeholder:text-placeholder"
        disabled={disabled}
        maxLength={1000}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Tell us what could have been better"
        value={value}
      />
    </label>
  );
}

function CancellationActions({
  isBusy,
  onBack,
  onConfirm,
}: {
  isBusy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-end gap-2">
      <button
        className="inline-flex h-10 items-center rounded-full px-4 font-medium text-[13px] text-fg-secondary transition-colors hover:bg-secondary disabled:opacity-50"
        disabled={isBusy}
        onClick={onBack}
        type="button"
      >
        Keep plan
      </button>
      <button
        className="inline-flex h-10 items-center gap-2 rounded-full bg-[#a0443e] px-4 font-medium text-[13px] text-white transition-colors hover:bg-[#8f3934] disabled:opacity-50"
        disabled={isBusy}
        onClick={onConfirm}
        type="button"
      >
        {isBusy ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
        Cancel at period end
      </button>
    </div>
  );
}
