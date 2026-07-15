"use client";

import type {
  BillingCancel,
  BillingCancellationReason,
  BillingStateResponse,
  BillingSubscriptionActionResponse,
} from "@cheatcode/types";
import { ModalShell } from "@cheatcode/ui";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { ChevronDown, CreditCard, Loader2 } from "@/components/ui/icons";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { requestBillingCancellation, requestBillingReactivation } from "@/lib/api/billing";
import { BILLING_STATE_QUERY_KEY, useBillingStateQuery } from "@/lib/hooks/use-billing";

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

type DialogStep = "cancel" | "overview";

interface ManageSubscriptionDialogProps {
  getToken: () => Promise<null | string>;
  onClose: () => void;
  open: boolean;
  planDisplayName: string;
  sandboxHoursTotal: number;
}

export function ManageSubscriptionDialog({
  getToken,
  onClose,
  open,
  planDisplayName,
  sandboxHoursTotal,
}: ManageSubscriptionDialogProps) {
  const controller = useManageSubscriptionController({ getToken, onClose, open, planDisplayName });
  return (
    <ModalShell
      ariaLabel="Manage plan"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-[24px] border-border"
      onClose={controller.closeDialog}
      open={open}
    >
      <ManageDialogFrame
        controller={controller}
        planDisplayName={planDisplayName}
        sandboxHoursTotal={sandboxHoursTotal}
      />
    </ModalShell>
  );
}

function useManageSubscriptionController({
  getToken,
  onClose,
  open,
  planDisplayName,
}: Pick<ManageSubscriptionDialogProps, "getToken" | "onClose" | "open" | "planDisplayName">) {
  const queryClient = useQueryClient();
  const stateQuery = useBillingStateQuery(getToken, open);
  const [step, setStep] = useState<DialogStep>("overview");
  const [reason, setReason] = useState<BillingCancellationReason | "">("");
  const [comment, setComment] = useState("");
  const cancelMutation = useCancellationMutation(getToken, queryClient, () => setStep("overview"));
  const reactivateMutation = useReactivationMutation(getToken, queryClient, planDisplayName);
  const isBusy = cancelMutation.isPending || reactivateMutation.isPending;

  function closeDialog() {
    if (isBusy) return;
    setStep("overview");
    setReason("");
    setComment("");
    onClose();
  }

  function confirmCancellation() {
    const trimmedComment = comment.trim();
    cancelMutation.mutate({
      ...(trimmedComment ? { comment: trimmedComment } : {}),
      ...(reason ? { reason } : {}),
    });
  }

  return {
    closeDialog,
    comment,
    confirmCancellation,
    isBusy,
    reactivate: () => reactivateMutation.mutate(),
    reason,
    setComment,
    setReason,
    setStep,
    stateQuery,
    step,
  };
}

function useCancellationMutation(
  getToken: () => Promise<null | string>,
  queryClient: QueryClient,
  onSuccess: () => void,
) {
  return useMutation({
    mutationFn: (input: BillingCancel) => requestBillingCancellation(getToken, input),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Plan cancellation failed"),
    onSuccess: (result) => {
      updateCachedBillingState(queryClient, result);
      onSuccess();
      toast.success(cancellationSuccessMessage(result.currentPeriodEnd));
    },
  });
}

function useReactivationMutation(
  getToken: () => Promise<null | string>,
  queryClient: QueryClient,
  planDisplayName: string,
) {
  return useMutation({
    mutationFn: () => requestBillingReactivation(getToken),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Plan reactivation failed"),
    onSuccess: (result) => {
      updateCachedBillingState(queryClient, result);
      toast.success(`${planDisplayName} will keep renewing`);
    },
  });
}

function ManageDialogFrame({
  controller,
  planDisplayName,
  sandboxHoursTotal,
}: {
  controller: ReturnType<typeof useManageSubscriptionController>;
  planDisplayName: string;
  sandboxHoursTotal: number;
}) {
  return (
    <div className="p-1 text-foreground">
      <div className="rounded-[20px] bg-background p-5 sm:p-6">
        <div>
          <p className="font-medium text-[12px] text-placeholder">Billing</p>
          <h2 className="mt-1 font-semibold text-[20px] leading-7">Manage plan</h2>
        </div>
        <ManageDialogBody
          controller={controller}
          planDisplayName={planDisplayName}
          sandboxHoursTotal={sandboxHoursTotal}
        />
      </div>
    </div>
  );
}

function ManageDialogBody({
  controller,
  planDisplayName,
  sandboxHoursTotal,
}: {
  controller: ReturnType<typeof useManageSubscriptionController>;
  planDisplayName: string;
  sandboxHoursTotal: number;
}) {
  const { stateQuery } = controller;
  if (stateQuery.isLoading) return <ManagePlanLoading />;
  if (stateQuery.isError) return <ManagePlanError query={stateQuery} />;
  if (!stateQuery.data) return null;
  if (controller.step === "cancel") {
    return (
      <CancellationForm
        comment={controller.comment}
        isBusy={controller.isBusy}
        onBack={() => controller.setStep("overview")}
        onCommentChange={controller.setComment}
        onConfirm={controller.confirmCancellation}
        onReasonChange={controller.setReason}
        periodEnd={stateQuery.data.currentPeriodEnd}
        planDisplayName={planDisplayName}
        reason={controller.reason}
      />
    );
  }
  return (
    <PlanOverview
      isBusy={controller.isBusy}
      onCancel={() => controller.setStep("cancel")}
      onClose={controller.closeDialog}
      onReactivate={controller.reactivate}
      planDisplayName={planDisplayName}
      sandboxHoursTotal={sandboxHoursTotal}
      state={stateQuery.data}
    />
  );
}

function ManagePlanError({ query }: { query: ReturnType<typeof useBillingStateQuery> }) {
  return (
    <RecoveryCard
      action={{
        isPending: query.isFetching,
        label: "Reload plan",
        onClick: () => void query.refetch(),
        pendingLabel: "Loading plan…",
      }}
      className="mx-auto mt-5"
      description="Cheatcode couldn't load your subscription details. Try again."
      headingLevel={3}
      icon={CreditCard}
      size="compact"
      title="Plan details couldn't load"
    />
  );
}

function PlanOverview({
  isBusy,
  onCancel,
  onClose,
  onReactivate,
  planDisplayName,
  sandboxHoursTotal,
  state,
}: {
  isBusy: boolean;
  onCancel: () => void;
  onClose: () => void;
  onReactivate: () => void;
  planDisplayName: string;
  sandboxHoursTotal: number;
  state: BillingStateResponse;
}) {
  return (
    <div className="mt-5">
      <PlanSummaryCard
        planDisplayName={planDisplayName}
        sandboxHoursTotal={sandboxHoursTotal}
        state={state}
      />
      <PlanManagementMessage planDisplayName={planDisplayName} state={state} />
      <PlanOverviewActions
        isBusy={isBusy}
        onCancel={onCancel}
        onClose={onClose}
        onReactivate={onReactivate}
        planDisplayName={planDisplayName}
        state={state}
      />
    </div>
  );
}

function PlanSummaryCard({
  planDisplayName,
  sandboxHoursTotal,
  state,
}: {
  planDisplayName: string;
  sandboxHoursTotal: number;
  state: BillingStateResponse;
}) {
  return (
    <div className="rounded-[20px] bg-bg-elevated p-1 ring-1 ring-black/[0.03]">
      <div className="flex items-center justify-between gap-4 rounded-[16px] bg-background px-4 py-4 ring-1 ring-border/50">
        <div className="min-w-0">
          <p className="font-semibold text-[16px]">{planDisplayName}</p>
          <p className="mt-0.5 text-[12px] text-fg-secondary">
            {sandboxHoursTotal.toLocaleString()} sandbox-hours each month
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-3 py-1.5 font-medium text-[12px] text-fg-secondary">
          {billingStatusLabel(state)}
        </span>
      </div>
    </div>
  );
}

function PlanOverviewActions({
  isBusy,
  onCancel,
  onClose,
  onReactivate,
  planDisplayName,
  state,
}: {
  isBusy: boolean;
  onCancel: () => void;
  onClose: () => void;
  onReactivate: () => void;
  planDisplayName: string;
  state: BillingStateResponse;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        {state.canCancel ? <CancelPlanButton disabled={isBusy} onClick={onCancel} /> : null}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button
          className="inline-flex h-10 items-center rounded-full px-4 font-medium text-[13px] text-fg-secondary transition-colors hover:bg-secondary disabled:opacity-50"
          disabled={isBusy}
          onClick={onClose}
          type="button"
        >
          Done
        </button>
        {state.canReactivate ? (
          <ReactivateButton
            isBusy={isBusy}
            onClick={onReactivate}
            planDisplayName={planDisplayName}
          />
        ) : null}
      </div>
    </div>
  );
}

function CancelPlanButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      className="inline-flex h-10 items-center rounded-full px-3 font-medium text-[13px] text-danger-fg transition-colors hover:bg-danger-bg disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      Cancel plan
    </button>
  );
}

function ReactivateButton({
  isBusy,
  onClick,
  planDisplayName,
}: {
  isBusy: boolean;
  onClick: () => void;
  planDisplayName: string;
}) {
  return (
    <button
      className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-4 font-medium text-[13px] text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
      disabled={isBusy}
      onClick={onClick}
      type="button"
    >
      {isBusy ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
      Keep {planDisplayName}
    </button>
  );
}

function PlanManagementMessage({
  planDisplayName,
  state,
}: {
  planDisplayName: string;
  state: BillingStateResponse;
}) {
  if (state.canReactivate) {
    return (
      <p className="mt-4 rounded-[16px] bg-primary/10 px-4 py-3 text-[13px] text-brand-accent-fg leading-5">
        {planDisplayName} is scheduled to end {formatPeriodEnd(state.currentPeriodEnd)}. You can
        keep the plan active here.
      </p>
    );
  }
  if (state.canCancel) {
    return (
      <p className="mt-4 px-1 text-[13px] text-fg-secondary leading-5">
        Your plan renews automatically. If you cancel, access continues through the end of the
        current billing period.
      </p>
    );
  }
  return (
    <p className="mt-4 px-1 text-[13px] text-fg-secondary leading-5">
      Your plan is active. No subscription changes are needed for this account right now.
    </p>
  );
}

function CancellationForm({
  comment,
  isBusy,
  onBack,
  onCommentChange,
  onConfirm,
  onReasonChange,
  periodEnd,
  planDisplayName,
  reason,
}: {
  comment: string;
  isBusy: boolean;
  onBack: () => void;
  onCommentChange: (value: string) => void;
  onConfirm: () => void;
  onReasonChange: (value: BillingCancellationReason | "") => void;
  periodEnd: string | null;
  planDisplayName: string;
  reason: BillingCancellationReason | "";
}) {
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

function ManagePlanLoading() {
  return <CheatcodeLoader className="mt-5 min-h-[148px]" label="Loading plan details" />;
}

function updateCachedBillingState(
  queryClient: QueryClient,
  result: BillingSubscriptionActionResponse,
): void {
  queryClient.setQueryData<BillingStateResponse>(BILLING_STATE_QUERY_KEY, (current) =>
    current
      ? {
          ...current,
          cancelAtPeriodEnd: result.cancelAtPeriodEnd,
          canCancel: !result.cancelAtPeriodEnd,
          canReactivate: result.cancelAtPeriodEnd,
          currentPeriodEnd: result.currentPeriodEnd,
          currentPeriodStart: result.currentPeriodStart,
          subscriptionStatus: result.status,
        }
      : current,
  );
}

function billingStatusLabel(state: BillingStateResponse): string {
  if (state.cancelAtPeriodEnd) return `Ends ${formatPeriodEnd(state.currentPeriodEnd)}`;
  if (state.subscriptionStatus === "active") return "Active";
  if (state.subscriptionStatus === "trialing") return "Trial";
  if (state.subscriptionStatus === "past_due") return "Payment issue";
  if (state.subscriptionStatus === "none") return "Active";
  return state.subscriptionStatus.replaceAll("_", " ");
}

function cancellationSuccessMessage(periodEnd: string | null): string {
  return periodEnd ? `Plan will end ${formatPeriodEnd(periodEnd)}` : "Plan cancellation scheduled";
}

function formatPeriodEnd(value: string | null): string {
  if (!value) return "the end of this billing period";
  return BILLING_DATE_FORMATTER.format(new Date(value));
}

const BILLING_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});
