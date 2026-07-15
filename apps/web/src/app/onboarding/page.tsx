import { Suspense } from "react";
import { AuthRequiredGate } from "@/components/auth/auth-required-gate";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";

function OnboardingLoadingState() {
  return <CheatcodeLoader label="Loading onboarding" />;
}

export default function OnboardingPage() {
  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-foreground"
      id="main-content"
      tabIndex={-1}
    >
      <Suspense fallback={<OnboardingLoadingState />}>
        <AuthRequiredGate fallback={<OnboardingLoadingState />}>
          <OnboardingFlow />
        </AuthRequiredGate>
      </Suspense>
    </main>
  );
}
