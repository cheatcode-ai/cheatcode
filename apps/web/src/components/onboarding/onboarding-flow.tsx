"use client";

import {
  type OnboardingStep,
  OnboardingStepSchema,
  type OnboardingStepStatus,
  type PaidBillingTier,
  PaidBillingTierSchema,
  type PlanSummary,
  type UpdateUserProfile,
  type UserProfile,
} from "@cheatcode/types";
import { useAuth, useUser } from "@clerk/nextjs";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkle } from "@/components/onboarding/onboarding-icons";
import {
  BasicsStep,
  IntroStep,
  NameStep,
  PlanStep,
  ToolsStep,
} from "@/components/onboarding/onboarding-steps";
import { Loader2 } from "@/components/ui/icons";
import { requestCheckout } from "@/lib/api/billing";
import { useBillingCatalogQuery } from "@/lib/hooks/use-billing";
import { useProfileQuery, useUpdateProfileMutation } from "@/lib/hooks/use-profile";

type Phase = "finishing" | "loading" | "retry" | "stepping";

/** The set of paid tiers the catalog reports as purchasable right now (a tier is
 * unavailable until its Polar product id is configured). */
function availablePaidTiers(plans: PlanSummary[] | undefined): ReadonlySet<PaidBillingTier> {
  const tiers = new Set<PaidBillingTier>();
  for (const plan of plans ?? []) {
    const paid = PaidBillingTierSchema.safeParse(plan.id);
    if (paid.success && plan.available) {
      tiers.add(paid.data);
    }
  }
  return tiers;
}

const STEP_ORDER = OnboardingStepSchema.options;

interface StepProps {
  availableTiers: ReadonlySet<PaidBillingTier>;
  initialName: string;
  isBusy: boolean;
  onBasicsContinue: () => void;
  onBasicsSkip: () => void;
  onCheckout: (tier: PaidBillingTier) => void;
  onIntro: () => void;
  onNameContinue: (name: string) => void;
  onNameSkip: () => void;
  onPlanComplete: (target: string) => void;
  onToolsContinue: () => void;
  onToolsSkip: () => void;
}

export function OnboardingFlow() {
  const profileQuery = useProfileQuery();
  const mutation = useUpdateProfileMutation();
  const { getToken } = useAuth();
  const { isLoaded: userLoaded, user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Polar redirects back here with ?checkout=success after a completed purchase
  // (see useCheckoutMutation). Without this, the buyer lands back on the Plan step.
  const checkoutSucceeded = searchParams.get("checkout") === "success";
  const [phase, setPhase] = useState<Phase>("loading");
  const [stepIndex, setStepIndex] = useState(0);
  const guardedRef = useRef(false);
  const pendingTargetRef = useRef("/");
  const profile = profileQuery.data;
  const { mutateAsync } = mutation;
  const checkoutMutation = useCheckoutMutation(getToken);
  const catalogQuery = useBillingCatalogQuery(getToken);
  const availableTiers = availablePaidTiers(catalogQuery.data?.plans);

  const completeOnboarding = useCallback(
    async (target: string, planStatus: OnboardingStepStatus = "done") => {
      pendingTargetRef.current = target;
      setPhase("finishing");
      try {
        await mutateAsync({
          onboardingCompleted: true,
          onboardingStep: { status: planStatus, step: "plan" },
        });
        await user?.reload();
        // Force a fresh session token so the middleware's `metadata.onboarding_complete` claim
        // reflects the just-set public metadata — otherwise navigating bounces back to /onboarding
        // on the stale JWT.
        await getToken({ skipCache: true });
      } catch {
        setPhase("retry");
        return;
      }
      if (readClaimComplete(user?.publicMetadata)) {
        router.replace(target);
      } else {
        setPhase("retry");
      }
    },
    [getToken, mutateAsync, router, user],
  );

  useEffect(() => {
    if (guardedRef.current || !profile || !userLoaded) {
      return;
    }
    guardedRef.current = true;
    if (profile.onboardingCompletedAt) {
      void completeOnboarding("/");
      return;
    }
    if (checkoutSucceeded) {
      void completeOnboarding("/", "done");
      return;
    }
    setStepIndex(resumeIndex(profile.onboardingState.steps));
    setPhase("stepping");
  }, [profile, userLoaded, completeOnboarding, checkoutSucceeded]);

  function recordStep(step: OnboardingStep, status: OnboardingStepStatus, name?: string) {
    const patch: UpdateUserProfile = { onboardingStep: { status, step } };
    if (name) {
      patch.agentDisplayName = name;
    }
    mutation.mutate(patch);
  }

  function advance() {
    setStepIndex((index) => Math.min(index + 1, STEP_ORDER.length - 1));
  }

  if (profileQuery.isError) {
    return (
      <LoadErrorCard
        isPending={profileQuery.isFetching}
        onRetry={() => {
          void profileQuery.refetch();
        }}
      />
    );
  }
  if (phase === "loading") {
    return <StatusCard label="Loading..." />;
  }
  if (phase === "finishing") {
    return <StatusCard label="Finishing setup..." />;
  }
  if (phase === "retry") {
    return (
      <RetryCard
        isPending={mutation.isPending}
        onRetry={() => void completeOnboarding(pendingTargetRef.current)}
      />
    );
  }

  const stepName = STEP_ORDER[stepIndex];
  if (!stepName) {
    return <StatusCard label="Loading..." />;
  }

  const stepProps: StepProps = {
    availableTiers,
    initialName: profile?.agentDisplayName ?? "",
    isBusy: checkoutMutation.isPending,
    onBasicsContinue: () => {
      recordStep("basics", "done");
      advance();
    },
    onBasicsSkip: () => {
      recordStep("basics", "skipped");
      advance();
    },
    onCheckout: (tier) => {
      if (availableTiers.has(tier)) {
        checkoutMutation.mutate(tier);
      } else {
        toast.info("That plan isn't available yet - bring your own keys to start building now.");
      }
    },
    onIntro: () => {
      recordStep("intro", "done");
      advance();
    },
    onNameContinue: (name: string) => {
      recordStep("name", "done", name === "" ? undefined : name);
      advance();
    },
    onNameSkip: () => {
      recordStep("name", "skipped");
      advance();
    },
    onPlanComplete: (target: string) =>
      void completeOnboarding(target, target === "/" ? "done" : "skipped"),
    onToolsContinue: () => {
      recordStep("tools", "done");
      advance();
    },
    onToolsSkip: () => {
      recordStep("tools", "skipped");
      advance();
    },
  };

  return renderStep(stepName, stepProps);
}

function renderStep(stepName: OnboardingStep, props: StepProps): ReactNode {
  switch (stepName) {
    case "intro":
      return <IntroStep onContinue={props.onIntro} />;
    case "name":
      return (
        <NameStep
          initialName={props.initialName}
          onContinue={props.onNameContinue}
          onSkip={props.onNameSkip}
        />
      );
    case "tools":
      return <ToolsStep onContinue={props.onToolsContinue} onSkip={props.onToolsSkip} />;
    case "basics":
      return (
        <BasicsStep
          onComplete={props.onPlanComplete}
          onContinue={props.onBasicsContinue}
          onSkip={props.onBasicsSkip}
        />
      );
    case "plan":
      return (
        <PlanStep
          availableTiers={props.availableTiers}
          isBusy={props.isBusy}
          onCheckout={props.onCheckout}
          onComplete={props.onPlanComplete}
        />
      );
    default:
      return null;
  }
}

function useCheckoutMutation(getToken: () => Promise<null | string>) {
  return useMutation({
    mutationFn: (tier: PaidBillingTier) =>
      requestCheckout(getToken, {
        returnUrl: window.location.href,
        // Marker so the onboarding flow auto-completes on return instead of
        // dropping the buyer back on the Plan step.
        successUrl: `${window.location.origin}${window.location.pathname}?checkout=success`,
        tier,
      }),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Checkout failed");
    },
    onSuccess: (url) => {
      window.location.assign(url);
    },
  });
}

function StatusCard({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <Sparkle />
      <p className="flex items-center gap-2 font-medium text-[#585858] text-[14px] leading-[18px]">
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        {label}
      </p>
    </div>
  );
}

function StatusShell({
  detail,
  isPending,
  onRetry,
  title,
}: {
  detail: string;
  isPending: boolean;
  onRetry: () => void;
  title: string;
}) {
  return (
    <div className="flex max-w-[360px] flex-col items-center gap-4 text-center">
      <Sparkle />
      <p className="font-medium text-[#1B1B1B] text-[14px] leading-[18px]">{title}</p>
      <p className="font-medium text-[#585858] text-[13px] leading-[18px]">{detail}</p>
      <button
        className="mt-1 flex h-8 items-center gap-2 rounded-full bg-[#1B1B1B] px-3.5 font-medium text-[14px] text-white leading-[18px] transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        onClick={onRetry}
        type="button"
      >
        {isPending ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : null}
        Retry
      </button>
    </div>
  );
}

function RetryCard({ isPending, onRetry }: { isPending: boolean; onRetry: () => void }) {
  return (
    <StatusShell
      detail="Your progress is saved. We could not refresh your session - retry to finish, or this resolves on the next sign-in."
      isPending={isPending}
      onRetry={onRetry}
      title="Finishing setup..."
    />
  );
}

function LoadErrorCard({ isPending, onRetry }: { isPending: boolean; onRetry: () => void }) {
  return (
    <StatusShell
      detail="We could not reach your profile. Check the connection and try again."
      isPending={isPending}
      onRetry={onRetry}
      title="Setup could not load"
    />
  );
}

function resumeIndex(steps: UserProfile["onboardingState"]["steps"]): number {
  const index = STEP_ORDER.findIndex((step) => steps[step] === undefined);
  return index === -1 ? STEP_ORDER.length - 1 : index;
}

function readClaimComplete(metadata: unknown): boolean {
  return isRecord(metadata) && metadata["onboarding_complete"] === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
