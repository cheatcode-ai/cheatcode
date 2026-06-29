"use client";

import { ModalShell } from "@cheatcode/ui";
import { SignIn, SignUp } from "@clerk/nextjs";
import { useState, useSyncExternalStore } from "react";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { X } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";
import { clerkAuthAppearance } from "./clerk-auth-appearance";

export type AuthMode = "sign-in" | "sign-up";

interface AuthModalProps {
  open: boolean;
  id?: string | undefined;
  mode?: AuthMode | undefined;
  onClose: () => void;
  redirectTo?: string | undefined;
}

export function AuthModal({
  open,
  id = "cheatcode-auth-modal",
  mode = "sign-in",
  onClose,
  redirectTo,
}: AuthModalProps) {
  const titleId = `${id}-title`;
  const redirectPath = useAuthRedirectPath(redirectTo);

  if (!open) {
    return null;
  }

  return (
    <AuthModalContent
      initialMode={mode}
      key={mode}
      onClose={onClose}
      redirectPath={redirectPath}
      titleId={titleId}
    />
  );
}

function AuthModalContent({
  initialMode,
  onClose,
  redirectPath,
  titleId,
}: {
  initialMode: AuthMode;
  onClose: () => void;
  redirectPath: string;
  titleId: string;
}) {
  const [activeMode, setActiveMode] = useState<AuthMode>(initialMode);
  const isSignIn = activeMode === "sign-in";

  return (
    <ModalShell
      className="cheatcode-auth-dialog m-auto max-h-[calc(100vh-2rem)] w-[min(calc(100vw-2rem),442px)] max-w-[442px] overflow-visible border-0 bg-transparent p-0 text-[#1b1b1b] shadow-none backdrop:bg-black/25 backdrop:backdrop-blur-[8px]"
      labelledBy={titleId}
      onClose={onClose}
      open={true}
    >
      <div className="cheatcode-auth-card relative max-h-[calc(100vh-2rem)] overflow-hidden rounded-[22px] bg-white shadow-[0_28px_80px_rgba(0,0,0,0.16)] ring-1 ring-[#eeeeee]">
        <button
          aria-label="Close authentication modal"
          className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-[#707070] outline-none transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b] focus-visible:ring-2 focus-visible:ring-[#1b1b1b]/15"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
        <div className="px-10 pt-9 pb-8 max-sm:px-6">
          <div className="mb-4 flex justify-center">
            <span className="flex size-12 items-center justify-center text-[#dfa94f] drop-shadow-[0_1px_0_rgba(255,255,255,0.65)]">
              <CheatcodeMark aria-hidden="true" className="size-10" />
            </span>
          </div>
          <div className="mb-6 text-center">
            <h2 className="font-semibold text-[#1b1b1b] text-[20px] leading-6" id={titleId}>
              {isSignIn ? "Sign in to Cheatcode" : "Create your account"}
            </h2>
            <p className="mt-2 text-[#707070] text-[14px] leading-5">
              {isSignIn
                ? "Welcome back! Please sign in to continue"
                : "Welcome! Please fill in the details to get started."}
            </p>
          </div>
          {isSignIn ? (
            <SignIn
              appearance={clerkAuthAppearance}
              fallbackRedirectUrl={redirectPath}
              forceRedirectUrl={redirectPath}
              oauthFlow="popup"
              routing="hash"
              signUpUrl="#sign-up"
            />
          ) : (
            <SignUp
              appearance={clerkAuthAppearance}
              fallbackRedirectUrl={redirectPath}
              forceRedirectUrl={redirectPath}
              oauthFlow="popup"
              routing="hash"
              signInUrl="#sign-in"
            />
          )}
        </div>
        <div className="flex justify-center border-[#eeeeee] border-t bg-[#fafafa] px-4 py-5 text-[#707070] text-[14px]">
          <span>{isSignIn ? "Don’t have an account?" : "Already have an account?"}</span>
          <button
            className={cn(
              "ml-1 font-medium text-[#d99b36] transition-colors hover:text-[#b87418]",
              "paper-focus-ring rounded-sm",
            )}
            onClick={() => setActiveMode(isSignIn ? "sign-up" : "sign-in")}
            type="button"
          >
            {isSignIn ? "Sign up" : "Sign in"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function useAuthRedirectPath(redirectTo: string | undefined): string {
  const currentPath = useSyncExternalStore(subscribeToLocationChanges, readCurrentPath, () => "/");
  return redirectTo ?? currentPath;
}

function subscribeToLocationChanges(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

function readCurrentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}
