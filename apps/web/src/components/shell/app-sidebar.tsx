"use client";

import { usePathname } from "next/navigation";
import { AuthModal } from "@/components/auth/auth-modal";
import {
  type FullSidebarMode,
  useSidebarIdentity,
  useSidebarNavigationData,
  useSidebarPanelState,
} from "@/components/shell/sidebar-controller";
import { MobileSidebarButton, SidebarPanel } from "@/components/shell/sidebar-panel";
import { IconRail } from "@/components/shell/sidebar-rail";
import { useAppStore } from "@/lib/store/app-store";

type SidebarVariant = "full" | "rail";

export function AppSidebar({ variant = "full" }: { variant?: SidebarVariant }) {
  return variant === "rail" ? <RailSidebar /> : <FullSidebar mode="docked" />;
}

function RailSidebar() {
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  return (
    <>
      <MobileSidebarButton onClick={() => setSidebarOpen(true)} />
      <IconRail onExpand={() => setSidebarOpen(true)} />
      <FullSidebar mode="overlay" />
    </>
  );
}

function FullSidebar({ mode }: { mode: FullSidebarMode }) {
  const pathname = usePathname();
  const identity = useSidebarIdentity();
  const navigation = useSidebarNavigationData({
    getToken: identity.getToken,
    isSignedIn: identity.isSignedIn,
    pathname,
  });
  const panel = useSidebarPanelState(mode, pathname);
  return (
    <>
      <SidebarPanel identity={identity} navigation={navigation} panel={panel} pathname={pathname} />
      <AuthModal
        id="sidebar-auth-modal"
        mode={panel.authMode ?? "sign-in"}
        onClose={() => panel.setAuthMode(null)}
        open={panel.authMode !== null}
      />
    </>
  );
}
