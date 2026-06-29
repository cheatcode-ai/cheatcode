"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { AuthModal, type AuthMode } from "./auth-modal";

interface AuthRequiredGateProps {
  children: ReactNode;
  fallback: ReactNode;
  mode?: AuthMode | undefined;
  onCloseHref?: string | undefined;
}

export function AuthRequiredGate({
  children,
  fallback,
  mode = "sign-in",
  onCloseHref = "/",
}: AuthRequiredGateProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const shouldShowAuth = isLoaded && !isSignedIn;

  return (
    <>
      {isLoaded && isSignedIn ? children : fallback}
      <AuthModal
        id="auth-required-modal"
        mode={mode}
        onClose={() => router.replace(onCloseHref)}
        open={shouldShowAuth}
      />
    </>
  );
}
