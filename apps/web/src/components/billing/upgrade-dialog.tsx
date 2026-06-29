"use client";

import type { PlanSummary } from "@cheatcode/types";
import { PaidBillingTierSchema } from "@cheatcode/types";
import { ModalShell } from "@cheatcode/ui";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "@/components/ui/icons";
import { requestCheckout } from "@/lib/api/billing";
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
  const catalogQuery = useBillingCatalogQuery(getToken);
  const checkoutMutation = useMutation({
    mutationFn: (tier: PlanSummary["id"]) =>
      requestCheckout(getToken, {
        returnUrl: window.location.href,
        successUrl: window.location.href,
        tier: PaidBillingTierSchema.parse(tier),
      }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Checkout failed"),
    onSuccess: (url) => window.location.assign(url),
  });

  const paidPlans = (catalogQuery.data?.plans ?? []).filter((plan) => plan.id !== "free");

  return (
    <ModalShell
      ariaLabel="Choose a plan"
      className="m-auto w-full max-w-lg"
      onClose={onClose}
      open={open}
    >
      <div className="flex flex-col gap-4 p-5 text-[#1b1b1b]">
        <div>
          <h2 className="font-semibold text-[18px]">Choose a plan</h2>
          <p className="mt-1 text-[#5f5f5f] text-[14px]">
            Sandbox hours are billed monthly. Provider inference stays bring-your-own-key.
          </p>
        </div>
        <UpgradeDialogBody
          isLoading={catalogQuery.isLoading}
          onChoose={(tier) => checkoutMutation.mutate(tier)}
          paidPlans={paidPlans}
          pendingTier={checkoutMutation.isPending ? (checkoutMutation.variables ?? null) : null}
        />
      </div>
    </ModalShell>
  );
}

function UpgradeDialogBody({
  isLoading,
  onChoose,
  paidPlans,
  pendingTier,
}: {
  isLoading: boolean;
  onChoose: (tier: PlanSummary["id"]) => void;
  paidPlans: PlanSummary[];
  pendingTier: PlanSummary["id"] | null;
}) {
  if (isLoading) {
    return <p className="py-6 text-center text-[#a0a0a0] text-[14px]">Loading plans…</p>;
  }
  if (paidPlans.length === 0) {
    return (
      <p className="py-6 text-center text-[#a0a0a0] text-[14px]">
        Plans are temporarily unavailable.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {paidPlans.map((plan) => (
        <PlanRow
          isPending={pendingTier === plan.id}
          key={plan.id}
          onChoose={() => onChoose(plan.id)}
          plan={plan}
        />
      ))}
    </ul>
  );
}

function PlanRow({
  isPending,
  onChoose,
  plan,
}: {
  isPending: boolean;
  onChoose: () => void;
  plan: PlanSummary;
}) {
  const purchasable = plan.available && !plan.current;
  return (
    <li className="flex items-center justify-between gap-3 rounded-[16px] border border-[#ececec] bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium text-[#1b1b1b] text-[15px]">
          {plan.displayName}
          {plan.current ? " · current" : ""}
        </p>
        <p className="text-[#8a8a8a] text-[12px]">
          ${plan.monthlyPriceUsd}/mo · {plan.sandboxHoursPerMonth} sandbox-hours
        </p>
      </div>
      {purchasable ? (
        <button
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-[#1b1b1b] px-4 font-medium text-[14px] text-white transition-colors hover:bg-black disabled:opacity-50"
          disabled={isPending}
          onClick={onChoose}
          type="button"
        >
          {isPending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
          Choose
        </button>
      ) : (
        <span className="shrink-0 rounded-full border border-[#f1f1f1] px-3 py-1.5 text-[#a0a0a0] text-[12px]">
          {plan.current ? "Current" : "Coming soon"}
        </span>
      )}
    </li>
  );
}
