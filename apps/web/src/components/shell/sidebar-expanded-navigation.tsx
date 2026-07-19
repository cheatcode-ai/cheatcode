"use client";

import { ChevronDown } from "@cheatcode/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import type {
  ProjectRenameMutationState,
  SidebarBooleanUpdater,
} from "@/components/shell/sidebar.types";
import { ChatList } from "@/components/shell/sidebar-chat-list";
import type {
  SidebarProject,
  useSidebarChats,
  useSidebarProjects,
} from "@/components/shell/sidebar-data";
import { SidebarChatsIcon, SidebarProjectsIcon } from "@/components/shell/sidebar-nav-icons";
import {
  FOOTER_NAV,
  PRIMARY_NAV,
  WORKSPACE_SECTION_NAV,
} from "@/components/shell/sidebar-navigation-model";
import { ProjectList } from "@/components/shell/sidebar-project-list";
import { isNavItemActive, type NavItem } from "@/lib/navigation/nav-model";
import { cn } from "@/lib/ui/cn";

const PRIMARY_SIDEBAR_NAV = PRIMARY_NAV.filter((item) => item.id !== "projects");
const HELP_NAV = FOOTER_NAV.filter((item) => item.id === "cheatcode-101");

type SidebarSectionIcon = (props: {
  "aria-hidden"?: boolean | "false" | "true";
  className?: string;
}) => ReactNode;

interface SidebarNavigationProps {
  activeProjectId: string | null;
  activeThreadId: string | null;
  chatsOpen: boolean;
  onChatsOpenChange: SidebarBooleanUpdater;
  onProjectsOpenChange: SidebarBooleanUpdater;
  onRename: (project: SidebarProject, name: string) => void;
  pathname: string;
  projectsOpen: boolean;
  renameMutation: ProjectRenameMutationState;
  sidebarChats: ReturnType<typeof useSidebarChats>;
  sidebarProjects: ReturnType<typeof useSidebarProjects>;
}

export function SidebarMainNavigation(props: SidebarNavigationProps) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <nav aria-label="Navigation" className="flex flex-col gap-0.5 px-1 pb-1">
        {PRIMARY_SIDEBAR_NAV.map((item) => (
          <SidebarNavRow item={item} key={item.id} pathname={props.pathname} />
        ))}
        <SidebarChatsGroup {...props} />
        <div className="flex flex-none flex-col gap-0.5 pt-4">
          {WORKSPACE_SECTION_NAV.map((item) => (
            <SidebarNavRow item={item} key={item.id} pathname={props.pathname} />
          ))}
        </div>
        <SidebarProjectsGroup {...props} />
      </nav>
    </div>
  );
}

function SidebarChatsGroup(props: SidebarNavigationProps) {
  const toggleChats = () => {
    if (!props.chatsOpen) props.onProjectsOpenChange(() => false);
    props.onChatsOpenChange((current) => !current);
  };
  return (
    <>
      <SidebarSectionToggle
        icon={SidebarChatsIcon}
        label="Chats"
        onToggle={toggleChats}
        open={props.chatsOpen}
      />
      <SidebarCollapseRegion open={props.chatsOpen}>
        <ChatList activeThreadId={props.activeThreadId} chats={props.sidebarChats} />
      </SidebarCollapseRegion>
    </>
  );
}

function SidebarProjectsGroup(props: SidebarNavigationProps) {
  const toggleProjects = () => {
    if (!props.projectsOpen) props.onChatsOpenChange(() => false);
    props.onProjectsOpenChange((current) => !current);
  };
  return (
    <>
      <SidebarSectionToggle
        icon={SidebarProjectsIcon}
        label="Projects"
        onToggle={toggleProjects}
        open={props.projectsOpen}
      />
      <SidebarCollapseRegion open={props.projectsOpen}>
        <ProjectList
          activeProjectId={props.activeProjectId}
          onRename={props.onRename}
          projects={props.sidebarProjects}
          renameMutation={props.renameMutation}
        />
      </SidebarCollapseRegion>
    </>
  );
}

function SidebarSectionToggle({
  icon: Icon,
  label,
  onToggle,
  open,
}: {
  icon: SidebarSectionIcon;
  label: "Chats" | "Projects";
  onToggle: () => void;
  open: boolean;
}) {
  return (
    <button
      aria-expanded={open}
      aria-label={open ? `Collapse ${label.toLowerCase()}` : `Expand ${label.toLowerCase()}`}
      className="flex min-h-8 w-full items-center justify-between gap-2 rounded-full px-[9px] py-1.5 text-left font-medium text-[13px] text-fg-secondary transition-[background-color,color,transform] duration-150 ease-out hover:bg-background hover:text-foreground active:scale-[0.99] motion-reduce:transition-none dark:hover:bg-white/5"
      onClick={onToggle}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "h-3.5 w-3.5 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          open && "rotate-180",
        )}
      />
    </button>
  );
}

function SidebarCollapseRegion({ children, open }: { children: ReactNode; open: boolean }) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transform-none motion-reduce:transition-none",
        open
          ? "translate-y-0 grid-rows-[1fr] opacity-100"
          : "pointer-events-none -translate-y-1 grid-rows-[0fr] opacity-0",
      )}
      inert={open ? undefined : true}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function SidebarNavRow({ item, pathname }: { item: NavItem; pathname: string }) {
  if (item.target.kind !== "route") return null;
  const active = isNavItemActive(item, pathname);
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 w-full shrink-0 items-center gap-2 rounded-full px-[9px] font-medium text-[14px] leading-5 transition-colors",
        active
          ? "bg-background text-foreground dark:bg-white/5"
          : "text-fg-secondary hover:bg-background hover:text-foreground dark:hover:bg-white/5",
      )}
      href={item.target.href}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <item.icon aria-hidden="true" className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
    </Link>
  );
}

export function SidebarHelpNavigation({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Cheatcode help" className="px-1 pb-1">
      {HELP_NAV.map((item) => (
        <SidebarHelpCard item={item} key={item.id} pathname={pathname} />
      ))}
    </nav>
  );
}

function SidebarHelpCard({ item, pathname }: { item: NavItem; pathname: string }) {
  if (item.target.kind !== "route") return null;
  const active = isNavItemActive(item, pathname);
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "cheatcode-lifted-surface flex min-h-14 w-full items-start gap-2 rounded-2xl px-[9px] py-2 text-left transition-colors hover:text-foreground dark:bg-white/5",
        active ? "text-foreground" : "text-fg-secondary",
      )}
      href={item.target.href}
    >
      <item.icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-[14px] leading-5">{item.label}</span>
        <span className="block truncate text-[12px] text-placeholder leading-4">
          {item.description ?? "Learn what Cheatcode can do"}
        </span>
      </span>
    </Link>
  );
}
