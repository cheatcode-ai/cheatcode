"use client";

import { ModalShell } from "@cheatcode/ui";
import { SignIn, SignUp } from "@clerk/nextjs";
import { useSyncExternalStore } from "react";
import { X } from "@/components/ui/icons";
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

  const isSignIn = mode === "sign-in";
  return (
    <ModalShell
      className="cheatcode-auth-dialog m-auto max-h-[calc(100vh-2rem)] w-[min(calc(100vw-2rem),25rem)] max-w-[25rem] overflow-visible border-0 bg-transparent p-0 text-white shadow-none backdrop:bg-black/60 backdrop:backdrop-blur-[6px]"
      labelledBy={titleId}
      onClose={onClose}
      open={true}
    >
      <div className="relative mx-auto max-h-[calc(100vh-2rem)] w-fit overflow-y-auto">
        <span className="sr-only" id={titleId}>
          {isSignIn ? "Sign in to Cheatcode" : "Create your account"}
        </span>
        <button
          aria-label="Close authentication modal"
          className="absolute top-3.5 right-3.5 z-10 flex h-8 w-8 items-center justify-center rounded-full text-white/50 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/25"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
        {isSignIn ? (
          <SignIn
            appearance={clerkAuthAppearance}
            fallbackRedirectUrl={redirectPath}
            forceRedirectUrl={redirectPath}
            oauthFlow="popup"
            routing="hash"
          />
        ) : (
          <SignUp
            appearance={clerkAuthAppearance}
            fallbackRedirectUrl={redirectPath}
            forceRedirectUrl={redirectPath}
            oauthFlow="popup"
            routing="hash"
          />
        )}
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
