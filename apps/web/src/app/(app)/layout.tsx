import type { ReactNode } from "react";
import { ProtectedAppShell } from "@/components/auth/protected-app-shell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <ProtectedAppShell>{children}</ProtectedAppShell>;
}
