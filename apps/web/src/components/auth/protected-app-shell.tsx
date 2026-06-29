"use client";

import type { ReactNode } from "react";
import { AuthRequiredGate } from "@/components/auth/auth-required-gate";
import { AppChrome } from "@/components/shell/app-chrome";

export function ProtectedAppShell({ children }: { children: ReactNode }) {
  return (
    <AppChrome>
      <AuthRequiredGate fallback={<ProtectedRoutePreview />}>{children}</AuthRequiredGate>
    </AppChrome>
  );
}

function ProtectedRoutePreview() {
  return (
    <section
      aria-hidden="true"
      className="flex min-h-screen flex-1 items-center justify-center bg-[#fbfbfb] px-6"
    >
      <div className="grid w-full max-w-3xl gap-3">
        <div className="h-9 w-44 rounded-full bg-[#efefef]" />
        <div className="grid gap-3 md:grid-cols-3">
          <div className="h-32 rounded-[20px] border border-[#f1f1f1] bg-white" />
          <div className="h-32 rounded-[20px] border border-[#f1f1f1] bg-white" />
          <div className="h-32 rounded-[20px] border border-[#f1f1f1] bg-white" />
        </div>
        <div className="h-56 rounded-[24px] border border-[#f1f1f1] bg-white" />
      </div>
    </section>
  );
}
