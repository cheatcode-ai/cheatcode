"use client";

import type {
  BillingCancel,
  BillingCancellationReason,
  BillingStateResponse,
  BillingSubscriptionActionResponse,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  requestBillingCancellation,
  requestBillingPortal,
  requestBillingReactivation,
} from "@/lib/api/billing";
import { BILLING_STATE_QUERY_KEY, useBillingStateQuery } from "@/lib/hooks/use-billing";

type DialogStep = "cancel" | "overview";

interface UseManageSubscriptionOptions {
  onClose: () => void;
  open: boolean;
  planDisplayName: string;
}

export function useManageSubscription({
  onClose,
  open,
  planDisplayName,
}: UseManageSubscriptionOptions) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const stateQuery = useBillingStateQuery(getToken, open);
  const [step, setStep] = useState<DialogStep>("overview");
  const [reason, setReason] = useState<BillingCancellationReason | "">("");
  const [comment, setComment] = useState("");
  const cancelMutation = useCancellationMutation(getToken, queryClient, () => setStep("overview"));
  const portalMutation = useBillingPortalMutation(getToken);
  const reactivateMutation = useReactivationMutation(getToken, queryClient, planDisplayName);
  const isBusy =
    cancelMutation.isPending || portalMutation.isPending || reactivateMutation.isPending;

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
    openBillingPortal: () => portalMutation.mutate(),
    reactivate: () => reactivateMutation.mutate(),
    reason,
    setComment,
    setReason,
    setStep,
    stateQuery,
    step,
  };
}

export type ManageSubscriptionController = ReturnType<typeof useManageSubscription>;

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

function useBillingPortalMutation(getToken: () => Promise<null | string>) {
  return useMutation({
    mutationFn: () => requestBillingPortal(getToken),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Billing portal couldn't open"),
    onSuccess: (url) => window.location.assign(url),
  });
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

export function billingStatusLabel(state: BillingStateResponse): string {
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

export function formatPeriodEnd(value: string | null): string {
  if (!value) return "the end of this billing period";
  return BILLING_DATE_FORMATTER.format(new Date(value));
}

const BILLING_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});
