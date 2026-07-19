"use client";

import type { PlanSummary } from "@cheatcode/types";
import { PaidBillingTierSchema } from "@cheatcode/types";
import { CreditCard, Loader2, ModalShell } from "@cheatcode/ui";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { requestCheckout } from "@/lib/api/billing";
import { canCheckoutPlan, isBillingUpgrade } from "@/lib/billing/tiers";
import { useBillingCatalogQuery } from "@/lib/hooks/use-billing";

/**
 * Plan picker for upgrading. Lists every PAID tier from the billing catalog; a tier
 * is purchasable only when the catalog marks it `available` (i.e. its Polar product
 * id is configured), so Pro/Premium check out while Ultra/Max show "Coming soon"
 * until the owner creates their products. Checkout passes the tier the user picked
 * — no surface hardcodes a single tier.
 */
export function UpgradeDialog({
  getToken,
  onClose,
  open,
}: {
  getToken: () => Promise<null | string>;
  onClose: () => void;
  open: boolean;
}) {
  const controller = useUpgradeDialog(getToken);
  return (
    <ModalShell
      ariaLabel="Choose a plan"
      className="m-auto w-full max-w-lg"
      onClose={onClose}
      open={open}
    >
      <div className="flex flex-col gap-4 p-5 text-foreground">
        <UpgradeDialogHeader />
        <UpgradeDialogBody controller={controller} />
      </div>
    </ModalShell>
  );
}

function useUpgradeDialog(getToken: () => Promise<null | string>) {
  const query = useBillingCatalogQuery(getToken);
  const checkout = useMutation({
    mutationFn: (tier: PlanSummary["id"]) =>
      requestCheckout(getToken, {
        tier: PaidBillingTierSchema.parse(tier),
      }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Checkout failed"),
    onSuccess: (url) => window.location.assign(url),
  });
  return {
    checkout,
    currentTier: query.data?.currentTier ?? "free",
    paidPlans: (query.data?.plans ?? []).filter((plan) => plan.id !== "free"),
    query,
  };
}

function UpgradeDialogHeader() {
  return (
    <div>
      <h2 className="font-semibold text-[18px]">Choose a plan</h2>
      <p className="mt-1 text-[14px] text-fg-secondary">
        Sandbox hours are billed monthly. Provider inference stays bring-your-own-key.
      </p>
    </div>
  );
}

function UpgradeDialogBody({ controller }: { controller: ReturnType<typeof useUpgradeDialog> }) {
  if (controller.query.isLoading) {
    return <CheatcodeLoader className="min-h-[112px]" label="Loading plans" />;
  }
  if (controller.query.isError) {
    return <PlansLoadError controller={controller} />;
  }
  if (controller.paidPlans.length === 0) {
    return <PlansUnavailable />;
  }
  const pendingTier = controller.checkout.isPending
    ? (controller.checkout.variables ?? null)
    : null;
  return (
    <ul className="flex flex-col gap-2">
      {controller.paidPlans.map((plan) => (
        <PlanRow
          isPending={pendingTier === plan.id}
          key={plan.id}
          onChoose={() => controller.checkout.mutate(plan.id)}
          plan={plan}
          currentTier={controller.currentTier}
        />
      ))}
    </ul>
  );
}

function PlansLoadError({ controller }: { controller: ReturnType<typeof useUpgradeDialog> }) {
  return (
    <RecoveryCard
      action={{
        isPending: controller.query.isFetching,
        label: "Reload plans",
        onClick: () => void controller.query.refetch(),
        pendingLabel: "Loading plans…",
      }}
      className="mx-auto"
      description="Cheatcode couldn't reach the billing catalog. Try loading the plans again."
      headingLevel={3}
      icon={CreditCard}
      size="compact"
      title="Plans couldn't load"
    />
  );
}

function PlansUnavailable() {
  return (
    <RecoveryCard
      announce="off"
      className="mx-auto"
      description="Paid plans aren't configured right now. You can keep using your current plan."
      headingLevel={3}
      icon={CreditCard}
      size="compact"
      title="Plans aren't available yet"
    />
  );
}

function PlanRow({
  currentTier,
  isPending,
  onChoose,
  plan,
}: {
  currentTier: PlanSummary["id"];
  isPending: boolean;
  onChoose: () => void;
  plan: PlanSummary;
}) {
  const purchasable = canCheckoutPlan(plan, currentTier);
  return (
    <li className="flex items-center justify-between gap-3 rounded-[16px] border border-border bg-background px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium text-[15px] text-foreground">
          {plan.displayName}
          {plan.current ? " · current" : ""}
        </p>
        <p className="text-[12px] text-placeholder">
          ${plan.monthlyPriceUsd}/mo · {plan.sandboxHoursPerMonth} sandbox-hours
        </p>
      </div>
      {purchasable ? (
        <button
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-foreground px-4 font-medium text-[14px] text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
          disabled={isPending}
          onClick={onChoose}
          type="button"
        >
          {isPending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
          Choose
        </button>
      ) : (
        <span className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[12px] text-placeholder">
          {planStatus(plan, currentTier)}
        </span>
      )}
    </li>
  );
}

function planStatus(plan: PlanSummary, currentTier: PlanSummary["id"]): string {
  if (plan.current) return "Current";
  if (!plan.available && isBillingUpgrade(plan.id, currentTier)) return "Coming soon";
  return "Included";
}
