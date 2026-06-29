"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { AuthModal, type AuthMode } from "@/components/auth/auth-modal";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { Monitor } from "@/components/ui/icons";

export function AuthRoutePage({ mode }: { mode: AuthMode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const redirectPath = useRedirectPath();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      router.replace(redirectPath);
    }
  }, [isLoaded, isSignedIn, redirectPath, router]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-[#1b1b1b]">
      <div className="fixed top-3.5 right-3.5 z-20 hidden h-7 items-center gap-2 rounded-full bg-[#f7f7f7] pr-3 pl-2.5 text-[14px] md:flex">
        <Monitor aria-hidden="true" className="h-3.5 w-3.5" />
        Computer
      </div>
      <section
        aria-hidden="true"
        className="mx-auto flex min-h-screen w-full max-w-[704px] flex-col items-center px-6 pt-[154px]"
      >
        <CheatcodeMark aria-hidden="true" className="mb-7 h-10 w-10 text-[#f8af2c]" />
        <div className="mb-2 h-4 w-40 rounded-full bg-[#f7f7f7]" />
        <div className="h-8 w-72 rounded-full bg-[#f1f1f1]" />
        <div className="mt-16 h-[132px] w-full rounded-[24px] border border-[#f1f1f1] bg-white shadow-[0_18px_70px_rgba(0,0,0,0.06)]" />
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
  const candidate =
    params.get("redirect_url") ?? params.get("redirectUrl") ?? params.get("redirect") ?? "/";
  return safeLocalRedirect(candidate, window.location.origin) ?? "/";
}

function safeLocalRedirect(value: string, origin: string): string | null {
  if (value.startsWith("/")) {
    return value;
  }
  try {
    const parsed = new URL(value);
    if (parsed.origin !== origin) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
