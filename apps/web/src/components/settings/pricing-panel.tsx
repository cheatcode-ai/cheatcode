"use client";

import type { BillingTier, PlanSummary } from "@cheatcode/types";
import { PaidBillingTierSchema } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ManageSubscriptionDialog } from "@/components/billing/manage-subscription-dialog";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { CreditCard, Loader2 } from "@/components/ui/icons";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { requestCheckout } from "@/lib/api/billing";
import { canCheckoutPlan, isBillingUpgrade } from "@/lib/billing/tiers";
import { useBillingCatalogQuery } from "@/lib/hooks/use-billing";
import { cn } from "@/lib/ui/cn";

export function PricingPanel() {
  const { getToken } = useAuth();
  const catalogQuery = useBillingCatalogQuery(getToken);
  const [managerOpen, setManagerOpen] = useState(false);
  const checkoutMutation = usePricingCheckout(getToken);
  const currentPlan = catalogQuery.data?.plans.find((plan) => plan.current) ?? null;

  return (
    <div className="text-foreground">
      <PricingHeader />
      <PricingPanelBody
        currentTier={catalogQuery.data?.currentTier ?? "free"}
        isError={catalogQuery.isError}
        isLoading={catalogQuery.isLoading}
        isRetrying={catalogQuery.isFetching}
        onChoose={(plan) => checkoutMutation.mutate(plan)}
        onManage={() => setManagerOpen(true)}
        onRetry={() => void catalogQuery.refetch()}
        pendingTier={checkoutMutation.isPending ? (checkoutMutation.variables?.id ?? null) : null}
        plans={catalogQuery.data?.plans ?? []}
      />
      {currentPlan && currentPlan.id !== "free" ? (
        <ManageSubscriptionDialog
          getToken={getToken}
          onClose={() => setManagerOpen(false)}
          open={managerOpen}
          planDisplayName={currentPlan.displayName}
          sandboxHoursTotal={currentPlan.sandboxHoursPerMonth}
        />
      ) : null}
    </div>
  );
}

function PricingHeader() {
  return (
    <header className="mb-8 px-1">
      <h1 className="hidden font-semibold text-foreground text-xl leading-7 md:block">Pricing</h1>
      <p className="mt-1.5 max-w-2xl text-fg-secondary text-sm leading-5">
        Choose the sandbox hours and project capacity that fit your work. Every account uses one
        private computer, and provider inference remains bring-your-own-key.
      </p>
    </header>
  );
}

function PricingPanelBody({
  currentTier,
  isError,
  isLoading,
  isRetrying,
  onChoose,
  onManage,
  onRetry,
  pendingTier,
  plans,
}: {
  currentTier: BillingTier;
  isError: boolean;
  isLoading: boolean;
  isRetrying: boolean;
  onChoose: (plan: PlanSummary) => void;
  onManage: () => void;
  onRetry: () => void;
  pendingTier: BillingTier | null;
  plans: PlanSummary[];
}) {
  if (isLoading) return <CheatcodeLoader className="min-h-72" label="Loading pricing" />;
  if (isError) return <PricingError isRetrying={isRetrying} onRetry={onRetry} />;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {plans.map((plan) => (
        <PricingCard
          currentTier={currentTier}
          isPending={pendingTier === plan.id}
          key={plan.id}
          onChoose={() => onChoose(plan)}
          onManage={onManage}
          plan={plan}
        />
      ))}
    </ul>
  );
}

function PricingError({ isRetrying, onRetry }: { isRetrying: boolean; onRetry: () => void }) {
  return (
    <RecoveryCard
      action={{
        isPending: isRetrying,
        label: "Reload plans",
        onClick: onRetry,
        pendingLabel: "Loading plans…",
      }}
      className="mx-auto"
      description="Cheatcode couldn't reach the billing catalog. Try loading it again."
      icon={CreditCard}
      title="Pricing couldn't load"
    />
  );
}

function PricingCard({
  currentTier,
  isPending,
  onChoose,
  onManage,
  plan,
}: {
  currentTier: BillingTier;
  isPending: boolean;
  onChoose: () => void;
  onManage: () => void;
  plan: PlanSummary;
}) {
  return (
    <li
      className={cn(
        "flex min-h-64 flex-col rounded-[22px] border bg-background p-5",
        plan.current ? "border-border shadow-[0_0_0_3px_var(--border-subtle)]" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-[17px]">{plan.displayName}</h2>
          <PlanPrice plan={plan} />
        </div>
        {plan.current ? <CurrentPlanBadge /> : null}
      </div>
      <PlanBenefits plan={plan} />
      <div className="mt-auto pt-5">
        <PricingCardAction
          currentTier={currentTier}
          isPending={isPending}
          onChoose={onChoose}
          onManage={onManage}
          plan={plan}
        />
      </div>
    </li>
  );
}

function PlanPrice({ plan }: { plan: PlanSummary }) {
  return (
    <p className="mt-2 flex items-baseline gap-1 text-fg-secondary">
      <span className="font-semibold text-2xl text-foreground tabular-nums">
        ${plan.monthlyPriceUsd}
      </span>
      <span className="text-[13px]">/ month</span>
    </p>
  );
}

function CurrentPlanBadge() {
  return (
    <span className="shrink-0 rounded-full bg-bg-secondary px-2.5 py-1 font-medium text-[11px] text-fg-secondary">
      Current
    </span>
  );
}

function PlanBenefits({ plan }: { plan: PlanSummary }) {
  return (
    <ul className="mt-5 space-y-2 text-[13px] text-fg-secondary leading-5">
      <li>{plan.sandboxHoursPerMonth.toLocaleString()} sandbox-hours monthly</li>
      <li>{plan.limits.maxProjects?.toLocaleString() ?? "Unlimited"} active projects</li>
    </ul>
  );
}

function PricingCardAction({
  currentTier,
  isPending,
  onChoose,
  onManage,
  plan,
}: {
  currentTier: BillingTier;
  isPending: boolean;
  onChoose: () => void;
  onManage: () => void;
  plan: PlanSummary;
}) {
  if (plan.current && plan.id !== "free") {
    return <PlanButton label="Manage plan" onClick={onManage} />;
  }
  if (plan.current) return <PlanStatus label="Current plan" />;
  if (canCheckoutPlan(plan, currentTier)) {
    return (
      <PlanButton
        isPending={isPending}
        label={isPending ? "Opening checkout…" : `Choose ${plan.displayName}`}
        onClick={onChoose}
      />
    );
  }
  if (!plan.available && isBillingUpgrade(plan.id, currentTier)) {
    return <PlanStatus label="Coming soon" />;
  }
  return <PlanStatus label={`Included in ${titleCaseTier(currentTier)}`} />;
}

function PlanButton({
  isPending = false,
  label,
  onClick,
}: {
  isPending?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 font-medium text-[13px] text-background transition-colors hover:bg-foreground/90 disabled:cursor-wait disabled:opacity-60"
      disabled={isPending}
      onClick={onClick}
      type="button"
    >
      {isPending ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
      {label}
    </button>
  );
}

function PlanStatus({ label }: { label: string }) {
  return (
    <span className="flex min-h-10 w-full items-center justify-center rounded-full bg-secondary px-4 font-medium text-[13px] text-fg-secondary">
      {label}
    </span>
  );
}

function usePricingCheckout(getToken: () => Promise<null | string>) {
  return useMutation({
    mutationFn: (plan: PlanSummary) =>
      requestCheckout(getToken, {
        returnUrl: window.location.href,
        successUrl: window.location.href,
        tier: PaidBillingTierSchema.parse(plan.id),
      }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Checkout failed"),
    onSuccess: (url) => window.location.assign(url),
  });
}

function titleCaseTier(tier: BillingTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
