import type { PaidBillingTier } from "@cheatcode/types";
import { Sparkle } from "@/components/onboarding/onboarding-icons";
import {
  OnboardingEyebrow,
  OnboardingStepShell,
  OnboardingStepTitle,
} from "./onboarding-step-primitives";

const TIERS = [
  { bullet: "60 sandbox hours / month", name: "Pro", price: "$25/mo", tier: "pro" },
  { bullet: "140 sandbox hours / month", name: "Premium", price: "$50/mo", tier: "premium" },
  { bullet: "320 sandbox hours / month", name: "Ultra", price: "$99/mo", tier: "ultra" },
  { bullet: "800 sandbox hours / month", name: "Max", price: "$200/mo", tier: "max" },
] as const satisfies readonly {
  bullet: string;
  name: string;
  price: string;
  tier: PaidBillingTier;
}[];

export function PlanStep({
  availableTiers,
  isBusy,
  onCheckout,
  onComplete,
}: {
  availableTiers: ReadonlySet<PaidBillingTier>;
  isBusy: boolean;
  onCheckout: (tier: PaidBillingTier) => void;
  onComplete: (target: string) => void;
}) {
  return (
    <OnboardingStepShell width={360}>
      <Sparkle />
      <OnboardingEyebrow>4/4</OnboardingEyebrow>
      <OnboardingStepTitle>Last thing, add sandbox time to start building.</OnboardingStepTitle>
      <div className="flex w-full flex-col gap-2 pt-[22px]">
        {TIERS.map((tier) => (
          <PlanCard
            available={availableTiers.has(tier.tier)}
            isBusy={isBusy}
            key={tier.name}
            onCheckout={onCheckout}
            tier={tier}
          />
        ))}
      </div>
      <button
        className="mt-5 flex h-[30px] items-center rounded-full bg-bg-secondary px-3.5 font-medium text-[13px] text-foreground leading-4 transition-colors hover:bg-bg-secondary"
        onClick={() => onComplete("/models#api-keys")}
        type="button"
      >
        Not ready for a plan? Bring your own keys
      </button>
      <button
        className="pt-3.5 font-medium text-[14px] text-foreground leading-[18px] hover:underline"
        onClick={() => onComplete("/")}
        type="button"
      >
        See the dashboard first
      </button>
    </OnboardingStepShell>
  );
}

function PlanCard({
  available,
  isBusy,
  onCheckout,
  tier,
}: {
  available: boolean;
  isBusy: boolean;
  onCheckout: (tier: PaidBillingTier) => void;
  tier: (typeof TIERS)[number];
}) {
  return (
    <div className="flex items-center rounded-[14px] bg-secondary py-2 pr-1.5 pl-3.5 shadow-[0_0_1px_0_rgba(0,0,0,0.12),0_1px_2px_0_rgba(0,0,0,0.04)]">
      <div className="flex flex-col gap-px">
        <div className="flex items-baseline gap-1.5">
          <span className="font-semibold text-[14px] text-foreground leading-[18px]">
            {tier.name}
          </span>
          <span className="font-bold text-[14px] text-foreground leading-[18px]">{tier.price}</span>
        </div>
        <span className="font-medium text-[12px] text-fg-secondary leading-4">{tier.bullet}</span>
      </div>
      <span className="flex-1" />
      <button
        className="flex h-8 items-center rounded-full bg-foreground px-3.5 font-medium text-[14px] text-background leading-[18px] transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isBusy || !available}
        onClick={() => onCheckout(tier.tier)}
        type="button"
      >
        Get {tier.name}
      </button>
    </div>
  );
}
