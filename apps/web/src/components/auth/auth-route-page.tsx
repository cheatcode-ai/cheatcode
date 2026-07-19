"use client";

import { Monitor } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { AuthModal, type AuthMode } from "@/components/auth/auth-modal";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { safeLocalRedirect } from "@/lib/navigation/safe-local-redirect";

export function AuthRoutePage({ mode }: { mode: AuthMode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const redirectPath = useRedirectPath();

  return (
    <main
      className="relative min-h-dvh overflow-hidden bg-[#0d0d0d] text-white"
      id="main-content"
      tabIndex={-1}
    >
      <div className="fixed top-3.5 right-3.5 z-20 hidden h-7 items-center gap-2 rounded-full bg-[#1a1a1a] pr-3 pl-2.5 text-[#d4d4d4] text-[14px] md:flex">
        <Monitor aria-hidden="true" className="h-3.5 w-3.5" />
        Computer
      </div>
      <section
        aria-hidden="true"
        className="mx-auto flex min-h-screen w-full max-w-[704px] flex-col items-center px-6 pt-[154px]"
      >
        <CheatcodeMark aria-hidden="true" className="mb-7 h-10 w-10 text-primary" />
        <div className="mb-2 h-4 w-40 rounded-full bg-[#1a1a1a]" />
        <div className="h-8 w-72 rounded-full bg-[#161616]" />
        <div className="mt-16 h-[132px] w-full rounded-[24px] border border-[#1f1f1f] bg-[#111111] shadow-[0_18px_70px_rgba(0,0,0,0.4)]" />
      </section>
      <AuthModal
        id="auth-route-modal"
        mode={mode}
        onClose={() => router.replace("/")}
        open={isLoaded && !isSignedIn}
        redirectTo={redirectPath}
      />
    </main>
  );
}

function useRedirectPath(): string {
  return useSyncExternalStore(subscribeToLocationChanges, readRedirectPath, () => "/");
}

function subscribeToLocationChanges(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

function readRedirectPath(): string {
  const params = new URLSearchParams(window.location.search);
  const candidate = params.get("redirect_url") ?? "/";
  return safeLocalRedirect(candidate, window.location.origin) ?? "/";
}
