import type { ReactNode } from "react";
import { Sparkle } from "@/components/onboarding/onboarding-icons";
import { cn } from "@/lib/ui/cn";
import {
  OnboardingActions,
  OnboardingEyebrow,
  OnboardingPrimaryPill,
  OnboardingSkipPill,
  OnboardingStepShell,
  OnboardingStepTitle,
} from "./onboarding-step-primitives";

export function BasicsStep({
  onComplete,
  onContinue,
  onSkip,
}: {
  onComplete: (target: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <OnboardingStepShell width={440}>
      <Sparkle />
      <OnboardingEyebrow>3/4</OnboardingEyebrow>
      <OnboardingStepTitle>
        Third, these are the 2 basic things you need to know about me:
      </OnboardingStepTitle>
      <NumberedLine className="pt-[22px]">1. You can teach me custom skills:</NumberedLine>
      <BasicCard>
        <div className="flex flex-col gap-px">
          <span className="font-medium text-[14px] text-foreground leading-[18px]">
            Invoice-chaser skill
          </span>
          <span className="font-medium text-[12px] text-fg-secondary leading-4">
            Chase overdue invoices, end to end.
          </span>
        </div>
        <span className="flex-1" />
        <PreviewPill onClick={() => onComplete("/skills")}>Create</PreviewPill>
      </BasicCard>
      <NumberedLine className="pt-[18px]">
        2. And this is the{" "}
        <span className="font-semibold underline decoration-1 underline-offset-2">computer</span> I
        use to code, store files, and browse.
      </NumberedLine>
      <OnboardingActions className="pt-9">
        <OnboardingSkipPill onClick={onSkip} />
        <OnboardingPrimaryPill onClick={onContinue}>Continue</OnboardingPrimaryPill>
      </OnboardingActions>
    </OnboardingStepShell>
  );
}

function NumberedLine({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("w-full font-medium text-[14px] text-foreground leading-[18px]", className)}>
      {children}
    </p>
  );
}

function BasicCard({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2.5 flex w-full items-center rounded-[14px] bg-secondary py-[9px] pr-1.5 pl-3.5 shadow-[0_0_1px_0_rgba(0,0,0,0.12),0_1px_2px_0_rgba(0,0,0,0.04)]">
      {children}
    </div>
  );
}

function PreviewPill({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      className="flex h-8 shrink-0 items-center rounded-full bg-foreground px-3.5 font-medium text-[14px] text-background leading-[18px] transition-colors hover:bg-foreground/90"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
