import type { OnboardingStep, OnboardingStepStatus, PaidBillingTier } from "@cheatcode/types";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { BasicsStep } from "./onboarding-basics-step";
import { IntroStep } from "./onboarding-intro-step";
import { NameStep } from "./onboarding-name-step";
import { PlanStep } from "./onboarding-plan-step";
import { ToolsStep } from "./onboarding-tools-step";
import { recordOnboardingStep, STEP_ORDER, type useOnboardingFlow } from "./use-onboarding-flow";

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

export function createOnboardingStepProps(flow: ReturnType<typeof useOnboardingFlow>): StepProps {
  const finish = (step: OnboardingStep, status: OnboardingStepStatus, name?: string) => {
    recordOnboardingStep(flow.mutation, step, status, name);
    flow.setStepIndex((index) => Math.min(index + 1, STEP_ORDER.length - 1));
  };
  return {
    availableTiers: flow.availableTiers,
    initialName: flow.profile?.agentDisplayName ?? "",
    isBusy: flow.checkoutMutation.isPending,
    onBasicsContinue: () => finish("basics", "done"),
    onBasicsSkip: () => finish("basics", "skipped"),
    onCheckout: (tier) => checkoutTier(flow, tier),
    onIntro: () => finish("intro", "done"),
    onNameContinue: (name) => finish("name", "done", name === "" ? undefined : name),
    onNameSkip: () => finish("name", "skipped"),
    onPlanComplete: (target) => {
      const isDashboardChoice = target === "/";
      void flow.completeOnboarding(
        isDashboardChoice ? flow.defaultTarget : target,
        isDashboardChoice ? "done" : "skipped",
      );
    },
    onToolsContinue: () => finish("tools", "done"),
    onToolsSkip: () => finish("tools", "skipped"),
  };
}

function checkoutTier(flow: ReturnType<typeof useOnboardingFlow>, tier: PaidBillingTier) {
  if (flow.availableTiers.has(tier)) {
    flow.checkoutMutation.mutate(tier);
  } else {
    toast.info("That plan isn't available yet - bring your own keys to start building now.");
  }
}

export function renderOnboardingStep(stepName: OnboardingStep, props: StepProps): ReactNode {
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
  }
}
