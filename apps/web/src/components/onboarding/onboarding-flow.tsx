"use client";

import { Sparkles as SparklesIcon } from "@cheatcode/ui";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { createOnboardingStepProps, renderOnboardingStep } from "./onboarding-step-router";
import { STEP_ORDER, useOnboardingFlow } from "./use-onboarding-flow";

export function OnboardingFlow() {
  const flow = useOnboardingFlow();
  if (flow.profileQuery.isError) {
    return (
      <LoadErrorCard
        isPending={flow.profileQuery.isFetching}
        onRetry={() => void flow.profileQuery.refetch()}
      />
    );
  }
  if (flow.phase === "loading") {
    return <StatusCard label="Loading..." />;
  }
  if (flow.phase === "finishing") {
    return <StatusCard label="Finishing setup..." />;
  }
  if (flow.phase === "retry") {
    return (
      <RetryCard
        isPending={flow.mutation.isPending}
        onRetry={() => void flow.completeOnboarding(flow.pendingTargetRef.current)}
      />
    );
  }
  const stepName = STEP_ORDER[flow.stepIndex];
  return stepName ? (
    renderOnboardingStep(stepName, createOnboardingStepProps(flow))
  ) : (
    <StatusCard label="Loading..." />
  );
}

function StatusCard({ label }: { label: string }) {
  return <CheatcodeLoader label={label} />;
}

function RetryCard({ isPending, onRetry }: { isPending: boolean; onRetry: () => void }) {
  return (
    <RecoveryCard
      action={{
        isPending,
        label: "Finish setup",
        onClick: onRetry,
        pendingLabel: "Finishing setup…",
      }}
      description="Your progress is saved. Try again to finish setting up your session."
      icon={SparklesIcon}
      title="Setup needs one more step"
    />
  );
}

function LoadErrorCard({ isPending, onRetry }: { isPending: boolean; onRetry: () => void }) {
  return (
    <RecoveryCard
      action={{
        isPending,
        label: "Reload setup",
        onClick: onRetry,
        pendingLabel: "Loading setup…",
      }}
      announce="assertive"
      description="Cheatcode couldn't reach your profile. Check your connection and try again."
      icon={SparklesIcon}
      title="Setup couldn't load"
    />
  );
}
