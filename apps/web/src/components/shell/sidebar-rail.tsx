"use client";

import { usePathname } from "next/navigation";
import { SidebarRailMoreMenu } from "@/components/shell/sidebar-rail-more-menu";
import { SidebarRailWorkspace } from "@/components/shell/sidebar-rail-navigation";

export function SidebarRailContent({
  onExpand,
  pathname,
}: {
  onExpand: () => void;
  pathname: string;
}) {
  return (
    <div className="flex size-full flex-col overflow-hidden rounded-[20.5px] bg-background">
      <SidebarRailWorkspace onExpand={onExpand} pathname={pathname} />
      <SidebarRailMoreMenu pathname={pathname} />
    </div>
  );
}

export function IconRail({ onExpand }: { onExpand: () => void }) {
  const pathname = usePathname();
  return (
    <aside className="fixed top-2 left-2 z-40 hidden h-[calc(100dvh-16px)] w-12 flex-col items-center overflow-hidden rounded-[24px] border-2 border-border bg-transparent p-0.5 md:flex">
      <SidebarRailContent onExpand={onExpand} pathname={pathname} />
    </aside>
  );
}
