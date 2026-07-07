import { Suspense } from "react";
import { AuthRequiredGate } from "@/components/auth/auth-required-gate";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-12 text-[#1b1b1b]">
      <Suspense
        fallback={
          <div className="h-96 w-full max-w-[392px] rounded-[28px] border border-[#f1f1f1] bg-white" />
        }
      >
        <AuthRequiredGate
          fallback={
            <div className="h-96 w-full max-w-[392px] rounded-[28px] border border-[#f1f1f1] bg-white shadow-[0_18px_70px_rgba(0,0,0,0.08)]" />
          }
        >
          <OnboardingFlow />
        </AuthRequiredGate>
      </Suspense>
    </main>
  );
}
