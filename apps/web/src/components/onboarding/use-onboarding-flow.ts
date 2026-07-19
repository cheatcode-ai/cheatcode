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
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { requestCheckout } from "@/lib/api/billing";
import { useBillingCatalogQuery } from "@/lib/hooks/use-billing";
import { useProfileQuery, useUpdateProfileMutation } from "@/lib/hooks/use-profile";
import { safeLocalRedirect } from "@/lib/navigation/safe-local-redirect";

type OnboardingPhase = "finishing" | "loading" | "retry" | "stepping";
export const STEP_ORDER = OnboardingStepSchema.options;
const REDIRECT_VALIDATION_ORIGIN = "https://redirect.invalid";

export function useOnboardingFlow() {
  const profileQuery = useProfileQuery();
  const mutation = useUpdateProfileMutation();
  const { getToken } = useAuth();
  const { isLoaded: userLoaded, user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutSucceeded = searchParams.get("checkout") === "success";
  const defaultTarget = readOnboardingTarget(searchParams.get("redirect_url"));
  const checkoutMutation = useCheckoutMutation(getToken);
  const catalogQuery = useBillingCatalogQuery(getToken);
  const progress = useOnboardingProgress({
    checkoutSucceeded,
    defaultTarget,
    getToken,
    mutation,
    profile: profileQuery.data,
    router,
    user,
    userLoaded,
  });
  return {
    ...progress,
    availableTiers: availablePaidTiers(catalogQuery.data?.plans),
    checkoutMutation,
    mutation,
    profile: profileQuery.data,
    profileQuery,
  };
}

function useOnboardingProgress(input: {
  checkoutSucceeded: boolean;
  defaultTarget: string;
  getToken: ReturnType<typeof useAuth>["getToken"];
  mutation: ReturnType<typeof useUpdateProfileMutation>;
  profile: UserProfile | undefined;
  router: ReturnType<typeof useRouter>;
  user: ReturnType<typeof useUser>["user"];
  userLoaded: boolean;
}) {
  const [phase, setPhase] = useState<OnboardingPhase>("loading");
  const [stepIndex, setStepIndex] = useState(0);
  const guardedRef = useRef(false);
  const pendingTargetRef = useRef(input.defaultTarget);
  const completeOnboarding = useCompleteOnboarding({
    ...input,
    pendingTargetRef,
    setPhase,
  });
  useEffect(() => {
    if (guardedRef.current || !input.profile || !input.userLoaded) {
      return;
    }
    guardedRef.current = true;
    if (input.profile.onboardingCompletedAt || input.checkoutSucceeded) {
      void completeOnboarding(input.defaultTarget, "done");
      return;
    }
    setStepIndex(resumeIndex(input.profile.onboardingState.steps));
    setPhase("stepping");
  }, [
    completeOnboarding,
    input.checkoutSucceeded,
    input.defaultTarget,
    input.profile,
    input.userLoaded,
  ]);
  return {
    completeOnboarding,
    defaultTarget: input.defaultTarget,
    pendingTargetRef,
    phase,
    setStepIndex,
    stepIndex,
  };
}

function useCompleteOnboarding(input: {
  getToken: ReturnType<typeof useAuth>["getToken"];
  mutation: ReturnType<typeof useUpdateProfileMutation>;
  pendingTargetRef: MutableRefObject<string>;
  router: ReturnType<typeof useRouter>;
  setPhase: Dispatch<SetStateAction<OnboardingPhase>>;
  user: ReturnType<typeof useUser>["user"];
}) {
  const { getToken, pendingTargetRef, router, setPhase, user } = input;
  const { mutateAsync } = input.mutation;
  return useCallback(
    async (target: string, planStatus: OnboardingStepStatus = "done") => {
      pendingTargetRef.current = target;
      setPhase("finishing");
      try {
        await mutateAsync({
          onboardingCompleted: true,
          onboardingStep: { status: planStatus, step: "plan" },
        });
        await user?.reload();
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
    [getToken, mutateAsync, pendingTargetRef, router, setPhase, user],
  );
}

export function recordOnboardingStep(
  mutation: ReturnType<typeof useUpdateProfileMutation>,
  step: OnboardingStep,
  status: OnboardingStepStatus,
  name?: string,
) {
  const patch: UpdateUserProfile = { onboardingStep: { status, step } };
  if (name) {
    patch.agentDisplayName = name;
  }
  mutation.mutate(patch);
}

function useCheckoutMutation(getToken: ReturnType<typeof useAuth>["getToken"]) {
  return useMutation({
    mutationFn: (tier: PaidBillingTier) =>
      requestCheckout(getToken, {
        tier,
      }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Checkout failed"),
    onSuccess: (url) => window.location.assign(url),
  });
}

function readOnboardingTarget(candidate: string | null): string {
  return candidate ? (safeLocalRedirect(candidate, REDIRECT_VALIDATION_ORIGIN) ?? "/") : "/";
}

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
