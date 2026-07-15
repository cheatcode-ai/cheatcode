"use client";

import type { ReactNode } from "react";
import { AuthRequiredGate } from "@/components/auth/auth-required-gate";
import { AppChrome } from "@/components/shell/app-chrome";
import { WorkspaceLoadingState } from "@/components/workspace/workspace-route-state";

export function ProtectedAppShell({ children }: { children: ReactNode }) {
  return (
    <AppChrome>
      <AuthRequiredGate fallback={<WorkspaceLoadingState />}>{children}</AuthRequiredGate>
    </AppChrome>
  );
}
