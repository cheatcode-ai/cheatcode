import { Suspense } from "react";
import { AuthRequiredGate } from "@/components/auth/auth-required-gate";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { Sparkle } from "@/components/onboarding/onboarding-icons";

function BootSparkle() {
  return (
    <div className="animate-pulse">
      <Sparkle />
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-12 text-[#1b1b1b]">
      <Suspense fallback={<BootSparkle />}>
        <AuthRequiredGate fallback={<BootSparkle />}>
          <OnboardingFlow />
        </AuthRequiredGate>
      </Suspense>
    </main>
  );
}
