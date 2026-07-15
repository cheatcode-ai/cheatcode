import type { ReactNode } from "react";
import { ReturnArrow } from "@/components/onboarding/onboarding-icons";
import { cn } from "@/lib/ui/cn";

export function OnboardingStepShell({
  children,
  width,
}: {
  children: ReactNode;
  width: 360 | 440;
}) {
  return (
    <div
      className="flex w-full flex-col items-center"
      style={{ maxWidth: width, fontSynthesis: "none" }}
    >
      {children}
    </div>
  );
}

export function OnboardingEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="pt-[26px] font-medium text-[13px] text-fg-secondary leading-4">{children}</p>
  );
}

export function OnboardingStepTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="pt-2.5 text-center font-medium text-[14px] text-foreground leading-[18px]">
      {children}
    </h1>
  );
}

export function OnboardingActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex items-center gap-2.5", className)}>{children}</div>;
}

export function OnboardingPrimaryPill({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex h-8 items-center gap-2 rounded-full px-3.5 font-medium text-[14px] leading-[18px] transition-colors",
        disabled
          ? "cursor-not-allowed bg-[#ababa8] text-white/90"
          : "bg-foreground text-background hover:bg-foreground/90",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
      <ReturnArrow />
    </button>
  );
}

export function OnboardingSkipPill({
  children,
  onClick,
}: {
  children?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="flex h-8 items-center rounded-full bg-background px-3.5 font-medium text-[14px] text-foreground leading-[18px] shadow-[inset_0_0_2px_0_rgba(0,0,0,0.02),0_0_1px_0_rgba(0,0,0,0.08)] transition-colors hover:bg-bg-secondary"
      onClick={onClick}
      type="button"
    >
      {children ?? "Skip"}
    </button>
  );
}
