import type { ReactNode } from "react";
import {
  IconBrowser,
  IconComputer,
  IconKeys,
  IconPhone,
  IconSkills,
  Sparkle,
} from "@/components/onboarding/onboarding-icons";
import {
  OnboardingActions,
  OnboardingPrimaryPill,
  OnboardingStepShell,
} from "./onboarding-step-primitives";

const FEATURE_ROWS: readonly {
  icon: ReactNode;
  key: string;
  lead?: string;
  strong: string;
  trail?: string;
}[] = [
  { icon: <IconComputer />, key: "computer", lead: "a full", strong: "computer" },
  { icon: <IconBrowser />, key: "browser", lead: "a full", strong: "browser" },
  { icon: <IconSkills />, key: "skills", strong: "skills", trail: "& integrations" },
  { icon: <IconKeys />, key: "keys", lead: "your models,", strong: "your keys" },
  { icon: <IconPhone />, key: "phone", lead: "live", strong: "phone previews" },
];

export function IntroStep({ onContinue }: { onContinue: () => void }) {
  return (
    <OnboardingStepShell width={360}>
      <Sparkle />
      <div className="flex justify-center pt-11 pb-1.5 text-[14px] text-foreground leading-[18px]">
        <span className="font-medium">I'm your&nbsp;</span>
        <span className="font-bold">agent team</span>
        <span className="font-medium">. I have:</span>
      </div>
      {FEATURE_ROWS.map((row) => (
        <FeatureRow key={row.key} row={row} />
      ))}
      <OnboardingActions className="pt-11">
        <OnboardingPrimaryPill onClick={onContinue}>Continue</OnboardingPrimaryPill>
      </OnboardingActions>
    </OnboardingStepShell>
  );
}

function FeatureRow({ row }: { row: (typeof FEATURE_ROWS)[number] }) {
  return (
    <div className="flex w-[200px] shrink-0 items-center gap-[9px] whitespace-nowrap pt-3 text-[14px] text-foreground leading-[18px]">
      <span className="mr-[9px] flex shrink-0">{row.icon}</span>
      {row.lead ? <span className="font-medium">{row.lead}</span> : null}
      <span className="font-semibold underline decoration-1 underline-offset-2">{row.strong}</span>
      {row.trail ? <span className="font-medium">{row.trail}</span> : null}
    </div>
  );
}
