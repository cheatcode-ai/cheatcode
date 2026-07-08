"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { AuthModal, type AuthMode } from "@/components/auth/auth-modal";

/**
 * Signed-out chrome for the home page: the top-right Sign in / Sign up header and
 * the auth modal. Renders nothing while Clerk is loading or once signed in — the
 * signed-in Computer surface is owned by {@link HomeWorkspace} / the shared
 * workspace shell.
 */
export function HomeSessionChrome() {
  const { isLoaded, isSignedIn } = useAuth();
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);

  if (!isLoaded || isSignedIn) {
    return null;
  }

  return (
    <>
      <header className="fixed top-0 right-0 left-[var(--cheatcode-sidebar-offset,16rem)] z-20 hidden h-14 items-center px-6 transition-[left] duration-200 md:flex">
        <div className="ml-auto flex items-center gap-3">
          <button
            className="paper-focus-ring h-8 rounded-full px-2.5 font-medium text-[#1b1b1b] text-[14px] leading-5 transition-colors hover:bg-[#f7f7f7]"
            onClick={() => setAuthMode("sign-in")}
            type="button"
          >
            Sign in
          </button>
          <button
            className="paper-focus-ring h-9 rounded-full bg-[#1b1b1b] px-4 font-medium text-[14px] text-white leading-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors hover:bg-[#2a2a2a]"
            onClick={() => setAuthMode("sign-up")}
            type="button"
          >
            Sign up
          </button>
        </div>
      </header>
      <AuthModal
        id="home-session-auth-modal"
        mode={authMode ?? "sign-in"}
        onClose={() => setAuthMode(null)}
        open={authMode !== null}
      />
    </>
  );
}
