"use client";

import { useState } from "react";
import { Sparkle } from "@/components/onboarding/onboarding-icons";
import {
  OnboardingActions,
  OnboardingEyebrow,
  OnboardingPrimaryPill,
  OnboardingSkipPill,
  OnboardingStepShell,
  OnboardingStepTitle,
} from "./onboarding-step-primitives";

export function NameStep({
  initialName,
  onContinue,
  onSkip,
}: {
  initialName: string;
  onContinue: (name: string) => void;
  onSkip: () => void;
}) {
  const [name, setName] = useState(initialName);
  const empty = name.trim().length === 0;
  return (
    <OnboardingStepShell width={360}>
      <Sparkle />
      <OnboardingEyebrow>1/4</OnboardingEyebrow>
      <OnboardingStepTitle>First, give your agents a name</OnboardingStepTitle>
      <input
        aria-label="Agent name"
        className="mt-[22px] h-[34px] w-[204px] rounded-full bg-secondary px-4 text-center font-medium text-[14px] text-foreground leading-[18px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] outline-none placeholder:text-placeholder focus:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !empty) {
            onContinue(name.trim());
          }
        }}
        placeholder="Name your agent"
        value={name}
      />
      <OnboardingActions className="pt-11">
        <OnboardingSkipPill onClick={onSkip} />
        <OnboardingPrimaryPill disabled={empty} onClick={() => onContinue(name.trim())}>
          Continue
        </OnboardingPrimaryPill>
      </OnboardingActions>
    </OnboardingStepShell>
  );
}
