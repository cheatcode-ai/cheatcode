"use client";

import type { BillingStateResponse } from "@cheatcode/types";
import { SubscriptionCancellationForm } from "@/components/billing/subscription-cancellation-form";
import {
  billingStatusLabel,
  formatPeriodEnd,
  type ManageSubscriptionController,
  useManageSubscription,
} from "@/components/billing/use-manage-subscription";
import { CreditCard, Loader2, ModalShell } from "@/components/ui";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { RecoveryCard } from "@/components/ui/recovery-card";
import type { useBillingStateQuery } from "@/lib/hooks/use-billing";

interface ManageSubscriptionDialogProps {
  onClose: () => void;
  open: boolean;
  planDisplayName: string;
  sandboxHoursTotal: number;
}

export function ManageSubscriptionDialog({
  onClose,
  open,
  planDisplayName,
  sandboxHoursTotal,
}: ManageSubscriptionDialogProps) {
  const controller = useManageSubscription({ onClose, open, planDisplayName });
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

function ManageDialogFrame({
  controller,
  planDisplayName,
  sandboxHoursTotal,
}: {
  controller: ManageSubscriptionController;
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
  controller: ManageSubscriptionController;
  planDisplayName: string;
  sandboxHoursTotal: number;
}) {
  const { stateQuery } = controller;
  if (stateQuery.isLoading) return <ManagePlanLoading />;
  if (stateQuery.isError) return <ManagePlanError query={stateQuery} />;
  if (!stateQuery.data) return null;
  if (controller.step === "cancel") {
    return (
      <SubscriptionCancellationForm
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
      onOpenBillingPortal={controller.openBillingPortal}
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
  onOpenBillingPortal,
  onReactivate,
  planDisplayName,
  sandboxHoursTotal,
  state,
}: {
  isBusy: boolean;
  onCancel: () => void;
  onClose: () => void;
  onOpenBillingPortal: () => void;
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
        onOpenBillingPortal={onOpenBillingPortal}
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
  onOpenBillingPortal,
  onReactivate,
  planDisplayName,
  state,
}: {
  isBusy: boolean;
  onCancel: () => void;
  onClose: () => void;
  onOpenBillingPortal: () => void;
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
          onClick={onOpenBillingPortal}
          type="button"
        >
          Billing details
        </button>
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

function ManagePlanLoading() {
  return <CheatcodeLoader className="mt-5 min-h-[148px]" label="Loading plan details" />;
}
