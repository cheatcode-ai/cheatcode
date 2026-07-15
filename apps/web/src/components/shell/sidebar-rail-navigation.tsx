"use client";

import Link from "next/link";
import {
  SidebarChatsIcon,
  SidebarPanelToggleIcon,
  SidebarProjectsIcon,
} from "@/components/shell/sidebar-nav-icons";
import { PRIMARY_NAV, WORKSPACE_SECTION_NAV } from "@/components/shell/sidebar-navigation-model";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import { isNavItemActive, type NavItem } from "@/lib/navigation/nav-model";
import { cn } from "@/lib/ui/cn";

const NEW_TASK_ITEM = PRIMARY_NAV.find((item) => item.id === "new-task");
const PROJECT_ITEM = PRIMARY_NAV.find((item) => item.id === "projects");

export function SidebarRailWorkspace({
  onExpand,
  pathname,
}: {
  onExpand: () => void;
  pathname: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[15px] rounded-b-[20.5px] bg-secondary">
      <SidebarRailHeader onExpand={onExpand} />
      <div className="relative min-h-0 flex-1">
        <nav aria-label="Workspace rail" className="flex h-full flex-col gap-0.5 px-1 pb-1">
          {NEW_TASK_ITEM ? <SidebarRailLink item={NEW_TASK_ITEM} pathname={pathname} /> : null}
          <SidebarRailChatsButton onExpand={onExpand} />
          {WORKSPACE_SECTION_NAV.map((item) => (
            <SidebarRailLink item={item} key={item.id} pathname={pathname} />
          ))}
          {PROJECT_ITEM ? (
            <SidebarRailProjectButton item={PROJECT_ITEM} onExpand={onExpand} pathname={pathname} />
          ) : null}
        </nav>
      </div>
    </div>
  );
}

function SidebarRailHeader({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center p-0.5">
      <div className="flex w-full items-center justify-center p-1">
        <CheatcodeTooltip label="Expand sidebar" side="right">
          <button
            aria-label="Expand sidebar"
            className="flex size-7 items-center justify-center rounded-full text-fg-secondary transition-[background-color,color,transform] duration-150 ease-out hover:bg-background hover:text-foreground active:scale-[0.97] motion-reduce:transition-none dark:hover:bg-white/5"
            onClick={onExpand}
            type="button"
          >
            <SidebarPanelToggleIcon />
          </button>
        </CheatcodeTooltip>
      </div>
    </div>
  );
}

function SidebarRailChatsButton({ onExpand }: { onExpand: () => void }) {
  return (
    <CheatcodeTooltip className="w-full" label="Chats" side="right">
      <button
        aria-label="Chats"
        className="flex h-8 w-full shrink-0 items-center rounded-full px-[9px] text-fg-secondary transition-[background-color,color,transform] duration-150 ease-out hover:bg-background hover:text-foreground active:scale-[0.97] motion-reduce:transition-none dark:hover:bg-white/5"
        onClick={onExpand}
        type="button"
      >
        <SidebarChatsIcon aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </CheatcodeTooltip>
  );
}

function SidebarRailProjectButton({
  item,
  onExpand,
  pathname,
}: {
  item: NavItem;
  onExpand: () => void;
  pathname: string;
}) {
  return (
    <CheatcodeTooltip className="w-full" label="Projects" side="right">
      <button
        aria-label="Projects"
        className={cn(
          "flex h-8 w-full shrink-0 items-center rounded-full px-[9px] transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none",
          isNavItemActive(item, pathname)
            ? "cheatcode-lifted-surface bg-background text-foreground dark:bg-white/5"
            : "text-fg-secondary hover:bg-background hover:text-foreground dark:hover:bg-white/5",
        )}
        onClick={onExpand}
        type="button"
      >
        <SidebarProjectsIcon aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </CheatcodeTooltip>
  );
}

export function SidebarRailLink({
  item,
  onNavigate,
  pathname,
}: {
  item: NavItem;
  onNavigate?: () => void;
  pathname: string;
}) {
  if (item.target.kind !== "route") return null;
  const active = isNavItemActive(item, pathname);
  return (
    <CheatcodeTooltip className="w-full" label={item.label} side="right">
      <Link
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 w-full shrink-0 items-center rounded-full px-[9px] transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none",
          active
            ? "cheatcode-lifted-surface bg-background text-foreground dark:bg-white/5"
            : "text-fg-secondary hover:bg-background hover:text-foreground dark:hover:bg-white/5",
        )}
        href={item.target.href}
        {...(onNavigate ? { onClick: onNavigate } : {})}
      >
        <item.icon
          aria-hidden="true"
          className={cn("h-3.5 w-3.5", item.id === "cheatcode-101" && "text-primary")}
        />
      </Link>
    </CheatcodeTooltip>
  );
}
