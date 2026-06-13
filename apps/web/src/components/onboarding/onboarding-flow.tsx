"use client";

import { env } from "@cheatcode/env/web";
import {
  BillingUrlResponseSchema,
  type OnboardingStep,
  OnboardingStepSchema,
  type OnboardingStepStatus,
  type UpdateUserProfile,
  type UserProfile,
} from "@cheatcode/types";
import { useAuth, useUser } from "@clerk/nextjs";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BasicsStep,
  IntroStep,
  NameStep,
  PlanStep,
  ToolsStep,
} from "@/components/onboarding/onboarding-steps";
import { Loader2 } from "@/components/ui/icons";
import { authorizedFetch } from "@/lib/api/authorized-fetch";
import { useProfileQuery, useUpdateProfileMutation } from "@/lib/hooks/use-profile";

type Phase = "finishing" | "loading" | "retry" | "stepping";

const STEP_ORDER = OnboardingStepSchema.options;

interface StepProps {
  canCheckout: boolean;
  initialName: string;
  isBusy: boolean;
  onBasicsContinue: () => void;
  onBasicsSkip: () => void;
  onCheckout: () => void;
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
  const [phase, setPhase] = useState<Phase>("loading");
  const [stepIndex, setStepIndex] = useState(0);
  const guardedRef = useRef(false);
  const pendingTargetRef = useRef("/projects");
  const profile = profileQuery.data;
  const { mutateAsync } = mutation;
  const checkoutMutation = useCheckoutMutation(getToken);

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
    [mutateAsync, router, user],
  );

  useEffect(() => {
    if (guardedRef.current || !profile || !userLoaded) {
      return;
    }
    guardedRef.current = true;
    if (profile.onboardingCompletedAt) {
      void completeOnboarding("/projects");
      return;
    }
    setStepIndex(resumeIndex(profile.onboardingState.steps));
    setPhase("stepping");
  }, [profile, userLoaded, completeOnboarding]);

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

  if (phase === "loading") {
    return <StatusCard label="Loading…" />;
  }
  if (phase === "finishing") {
    return <StatusCard label="Finishing setup…" />;
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
    return <StatusCard label="Loading…" />;
  }

  const stepProps: StepProps = {
    canCheckout: Boolean(env.NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID),
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
    onCheckout: () => checkoutMutation.mutate(),
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
      void completeOnboarding(target, target === "/projects" ? "done" : "skipped"),
    onToolsContinue: () => {
      recordStep("tools", "done");
      advance();
    },
    onToolsSkip: () => {
      recordStep("tools", "skipped");
      advance();
    },
  };

  return (
    <div className="w-full max-w-xl rounded-3xl border border-zinc-800/80 bg-[#0d0d0d] p-8 shadow-2xl">
      {renderStep(stepName, stepProps)}
    </div>
  );
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
      return <BasicsStep onContinue={props.onBasicsContinue} onSkip={props.onBasicsSkip} />;
    case "plan":
      return (
        <PlanStep
          canCheckout={props.canCheckout}
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
    mutationFn: async () => {
      const productId = env.NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID;
      if (!productId) {
        throw new Error("Polar product is not configured");
      }
      const response = await authorizedFetch(getToken, "/v1/billing/checkout", {
        body: JSON.stringify({
          productId,
          returnUrl: window.location.href,
          successUrl: window.location.href,
        }),
        method: "POST",
      });
      return BillingUrlResponseSchema.parse(await response.json()).url;
    },
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
    <div className="flex w-full max-w-xl flex-col items-center gap-4 rounded-3xl border border-zinc-800/80 bg-[#0d0d0d] p-12 text-center">
      <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-zinc-500" />
      <p className="text-sm text-zinc-400">{label}</p>
    </div>
  );
}

function RetryCard({ isPending, onRetry }: { isPending: boolean; onRetry: () => void }) {
  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-5 rounded-3xl border border-zinc-800/80 bg-[#0d0d0d] p-12 text-center">
      <p className="text-sm text-zinc-300">Finishing setup…</p>
      <p className="max-w-sm text-xs text-zinc-500 leading-relaxed">
        Your progress is saved. We could not refresh your session — retry to finish, or this
        resolves on the next sign-in.
      </p>
      <button
        className="inline-flex h-11 items-center justify-center rounded-2xl bg-white px-6 font-medium text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        onClick={onRetry}
        type="button"
      >
        {isPending ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : null}
        Retry
      </button>
    </div>
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
