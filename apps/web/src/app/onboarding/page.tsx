import { Suspense } from "react";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 py-12 text-zinc-200">
      <Suspense
        fallback={<div className="h-96 w-full max-w-xl rounded-3xl border border-zinc-800/80" />}
      >
        <OnboardingFlow />
      </Suspense>
    </main>
  );
}
