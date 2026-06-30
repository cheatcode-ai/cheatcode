"use client";

import type { ProjectSummary, Thread } from "@cheatcode/types";
import { ConfirmDialog, ModalShell } from "@cheatcode/ui";
import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AuthModal, type AuthMode } from "@/components/auth/auth-modal";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CreditCard,
  FileText,
  Link as LinkIcon,
  Loader2,
  type LucideIcon,
  Menu,
  Monitor,
  MoreHorizontal,
  MoreVertical,
  PanelLeftOpen,
  PanelRightOpen,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
  TrendingUp,
  User,
} from "@/components/ui/icons";
import {
  createChat,
  deleteProject,
  deleteThread,
  listProjects,
  listProjectThreads,
  listRecentThreads,
  updateProject,
  updateThread,
} from "@/lib/api/project-thread";
import { formatHoursUsed, useSandboxUsageQuery } from "@/lib/hooks/use-billing";
import { isNavItemActive, type NavItem, WORKSPACE_NAV } from "@/lib/navigation/nav-model";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

type SidebarVariant = "full" | "rail";
type FullSidebarMode = "docked" | "overlay";

interface SidebarChat {
  activeRunId: string | null;
  id: string;
  title: string | null;
}

interface SidebarProject {
  appType: "general" | "mobile" | "web";
  href: string | null;
  id: string;
  name: string;
  threadId: string | null;
  threads: SidebarChat[];
}

const PRIMARY_NAV = navItems("primary");
const WORKSPACE_SECTION_NAV = navItems("workspace");
const FOOTER_NAV = navItems("footer");
const CREDIT_BAR_KEYS = Array.from({ length: 50 }, (_, index) => `credit-bar-${index}`);
const SIDEBAR_MORE_LINKS = [
  { href: "/settings/account", icon: User, label: "Account" },
  { href: "/artifacts", icon: FileText, label: "Artifacts" },
  { href: "/settings/billing", icon: CreditCard, label: "Pricing" },
  { href: "/settings/billing", icon: TrendingUp, label: "Usage" },
] as const satisfies readonly SidebarMenuLinkItem[];

type SidebarMenuLinkItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

export function AppSidebar({ variant = "full" }: { variant?: SidebarVariant }) {
  if (variant === "rail") {
    return <RailSidebar />;
  }
  return <FullSidebar mode="docked" />;
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
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const { user } = useUser();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const router = useRouter();
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const activeThreadId = activeChatIdFromPathname(pathname);
  const sidebarProjects = useSidebarProjects(getToken, Boolean(isSignedIn));
  const sidebarChats = useSidebarChats(getToken, Boolean(isSignedIn));
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SidebarProject | null>(null);
  const [pendingRename, setPendingRename] = useState<SidebarProject | null>(null);
  const [chatsOpen, setChatsOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: (project: SidebarProject) => deleteProject(getToken, project.id),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Project delete failed");
    },
    onSettled: () => {
      setPendingDelete(null);
    },
    onSuccess: (_result, project) => {
      toast.success(`Deleted ${project.name}`);
      void queryClient.invalidateQueries({ queryKey: ["sidebar-projects"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] });
      if (project.threads.some((thread) => thread.id === activeThreadId)) {
        router.push("/");
      }
    },
  });
  const renameMutation = useMutation({
    mutationFn: ({ name, project }: { name: string; project: SidebarProject }) =>
      updateProject(getToken, project.id, { name }),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Project rename failed");
    },
    onSettled: () => {
      setPendingRename(null);
    },
    onSuccess: (result) => {
      toast.success(`Renamed to ${result.name}`);
      void queryClient.invalidateQueries({ queryKey: ["sidebar-projects"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] });
    },
  });
  const isOverlay = mode === "overlay";
  const isDockedCollapsed = !isOverlay && sidebarCollapsed;

  useEffect(() => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  useEffect(() => {
    if (isOverlay) {
      return;
    }
    document.documentElement.style.setProperty(
      "--cheatcode-sidebar-offset",
      isDockedCollapsed ? "4rem" : "16rem",
    );
  }, [isDockedCollapsed, isOverlay]);

  useEffect(() => {
    if (pathname.length === 0) {
      return;
    }
    setAccountOpen(false);
    setSettingsOpen(false);
  }, [pathname]);

  const displayName =
    user?.fullName ?? user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? "cheatcode";
  const primaryEmail = user?.primaryEmailAddress?.emailAddress ?? null;
  const initial = displayName.slice(0, 1).toUpperCase();
  const profileImageUrl = user?.hasImage && user.imageUrl ? user.imageUrl : null;

  return (
    <>
      {isOverlay ? null : <MobileSidebarButton onClick={() => setSidebarOpen(true)} />}
      {sidebarOpen ? (
        <button
          aria-label="Close sidebar"
          className={sidebarBackdropClass(isOverlay)}
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      ) : null}
      <aside
        className={cn(
          "fixed top-2 bottom-2 left-2 z-50 flex max-h-[calc(100vh-16px)] flex-col overflow-hidden rounded-[24px] border-2 border-[#f7f7f7] bg-transparent p-0.5 shadow-none transition-[width,transform] duration-200",
          isDockedCollapsed ? "w-12" : "w-60",
          sidebarTransformClass(isOverlay, sidebarOpen),
        )}
      >
        {isDockedCollapsed ? (
          <SidebarRailContent onExpand={() => setSidebarCollapsed(false)} pathname={pathname} />
        ) : (
          <ExpandedSidebarContent
            accountOpen={accountOpen}
            activeThreadId={activeThreadId}
            deleteMutation={deleteMutation}
            displayName={displayName}
            getToken={getToken}
            initial={initial}
            isLoaded={isLoaded}
            isOverlay={isOverlay}
            isSignedIn={Boolean(isSignedIn)}
            onAuthModeChange={setAuthMode}
            onCloseAccount={() => setAccountOpen(false)}
            onCloseSettings={() => setSettingsOpen(false)}
            onCollapse={() => {
              setAccountOpen(false);
              setProjectsOpen(false);
              setSettingsOpen(false);
              setSidebarCollapsed(true);
            }}
            chatsOpen={chatsOpen}
            onChatsOpenChange={setChatsOpen}
            onDelete={setPendingDelete}
            onProjectsOpenChange={setProjectsOpen}
            onRename={setPendingRename}
            renameMutation={renameMutation}
            sidebarChats={sidebarChats}
            onToggleAccount={() => {
              setAccountOpen((current) => !current);
              setSettingsOpen(false);
            }}
            onToggleSettings={() => {
              setSettingsOpen((current) => !current);
              setAccountOpen(false);
            }}
            pathname={pathname}
            primaryEmail={primaryEmail}
            profileImageUrl={profileImageUrl}
            projectsOpen={projectsOpen}
            settingsOpen={settingsOpen}
            sidebarProjects={sidebarProjects}
            signOut={() => {
              void signOut({ redirectUrl: "/" });
            }}
          />
        )}
      </aside>
      <ConfirmDialog
        busy={deleteMutation.isPending}
        cancelLabel="Cancel"
        confirmLabel="Delete project"
        description="This removes the project, its sandbox, and all generated files. Deployed previews stay live until they expire."
        destructive
        id="sidebar-delete-project-dialog"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            deleteMutation.mutate(pendingDelete);
          }
        }}
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : "Delete project?"}
      />
      <RenameDialog
        busy={renameMutation.isPending}
        heading="Rename project"
        initialName={pendingRename?.name ?? ""}
        inputAriaLabel="Project name"
        onCancel={() => setPendingRename(null)}
        onSubmit={(name) => {
          if (pendingRename) {
            renameMutation.mutate({ name, project: pendingRename });
          }
        }}
        open={pendingRename !== null}
      />
      <AuthModal
        id="sidebar-auth-modal"
        mode={authMode ?? "sign-in"}
        onClose={() => setAuthMode(null)}
        open={authMode !== null}
      />
    </>
  );
}

function ExpandedSidebarContent({
  accountOpen,
  activeThreadId,
  chatsOpen,
  deleteMutation,
  displayName,
  getToken,
  initial,
  isLoaded,
  isOverlay,
  isSignedIn,
  onAuthModeChange,
  onChatsOpenChange,
  onCloseAccount,
  onCloseSettings,
  onCollapse,
  onDelete,
  onProjectsOpenChange,
  onRename,
  onToggleAccount,
  onToggleSettings,
  pathname,
  primaryEmail,
  profileImageUrl,
  projectsOpen,
  renameMutation,
  settingsOpen,
  sidebarChats,
  sidebarProjects,
  signOut,
}: {
  accountOpen: boolean;
  activeThreadId: string | null;
  chatsOpen: boolean;
  deleteMutation: { isPending: boolean; variables?: SidebarProject | undefined };
  displayName: string;
  getToken: () => Promise<null | string>;
  initial: string;
  isLoaded: boolean;
  isOverlay: boolean;
  isSignedIn: boolean;
  onAuthModeChange: (mode: AuthMode) => void;
  onChatsOpenChange: (updater: (current: boolean) => boolean) => void;
  onCloseAccount: () => void;
  onCloseSettings: () => void;
  onCollapse: () => void;
  onDelete: (project: SidebarProject) => void;
  onProjectsOpenChange: (updater: (current: boolean) => boolean) => void;
  onRename: (project: SidebarProject) => void;
  onToggleAccount: () => void;
  onToggleSettings: () => void;
  pathname: string;
  primaryEmail: null | string;
  profileImageUrl: null | string;
  projectsOpen: boolean;
  renameMutation: {
    isPending: boolean;
    variables?: { name: string; project: SidebarProject } | undefined;
  };
  settingsOpen: boolean;
  sidebarChats: ReturnType<typeof useSidebarChats>;
  sidebarProjects: ReturnType<typeof useSidebarProjects>;
  signOut: () => void;
}) {
  return (
    <div className="flex size-full flex-col overflow-hidden rounded-[20.5px] bg-white">
      <div className="flex min-h-0 flex-1 flex-col rounded-b-[20.5px] bg-[#f7f7f7]">
        <div className="flex h-10 shrink-0 items-center p-0.5">
          <div className="flex w-full items-center justify-between gap-2 overflow-hidden p-0.5">
            {isLoaded && !isSignedIn ? (
              <button
                aria-label="Sign in to Cheatcode"
                className="paper-focus-ring flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md font-medium text-[#1b1b1b] text-[14px] leading-5 transition-opacity hover:opacity-80"
                onClick={() => onAuthModeChange("sign-in")}
                type="button"
              >
                <SidebarProfileAvatar brand displayName="cheatcode" initial="" imageUrl={null} />
                <span className="min-w-0 truncate">cheatcode</span>
              </button>
            ) : (
              <button
                aria-label={`Account: ${displayName}`}
                aria-expanded={accountOpen}
                className="paper-focus-ring flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md font-medium text-[#1b1b1b] text-[14px] leading-5 transition-opacity hover:opacity-80"
                onClick={onToggleAccount}
                title={displayName}
                type="button"
              >
                <SidebarProfileAvatar
                  displayName={displayName}
                  imageUrl={profileImageUrl}
                  initial={initial}
                />
                <span className="min-w-0 truncate text-left">{displayName}</span>
              </button>
            )}
            {!isOverlay ? (
              <button
                aria-label="Collapse sidebar"
                className="paper-focus-ring flex size-7 shrink-0 items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-white hover:text-[#1b1b1b]"
                onClick={onCollapse}
                title="Collapse sidebar"
                type="button"
              >
                <PanelRightOpen aria-hidden="true" className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        {accountOpen && isSignedIn ? (
          <SidebarAccountMenu
            displayName={displayName}
            email={primaryEmail}
            getToken={getToken}
            onNavigate={onCloseAccount}
            onSignOut={signOut}
          />
        ) : null}

        <div
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden",
            accountOpen && isSignedIn ? "mt-0" : "mt-[15px]",
          )}
        >
          <nav aria-label="Primary" className="flex flex-col gap-1 px-1 pb-1">
            {/* Chat-first: only "New chat" is a top-level row; Projects moves into the
                secondary collapsible below, so it isn't duplicated here. */}
            {PRIMARY_NAV.filter((item) => item.id !== "projects").map((item) => (
              <SidebarNavRow item={item} key={item.id} pathname={pathname} />
            ))}
            <button
              aria-expanded={chatsOpen}
              className="paper-focus-ring flex min-h-8 w-full items-center justify-between gap-2 rounded-full px-[9px] py-1.5 text-left font-medium text-[#5f5f5f] text-[13px] transition-colors hover:bg-white hover:text-[#1b1b1b]"
              onClick={() => onChatsOpenChange((current) => !current)}
              type="button"
            >
              <span>Chats</span>
              <ChevronDown
                aria-hidden="true"
                className={cn("h-3.5 w-3.5 transition-transform", chatsOpen && "rotate-180")}
              />
            </button>
            {chatsOpen ? <ChatList activeThreadId={activeThreadId} chats={sidebarChats} /> : null}

            <button
              aria-expanded={projectsOpen}
              className="paper-focus-ring mt-2 flex min-h-8 w-full items-center justify-between gap-2 rounded-full px-[9px] py-1.5 text-left font-medium text-[#5f5f5f] text-[13px] transition-colors hover:bg-white hover:text-[#1b1b1b]"
              onClick={() => onProjectsOpenChange((current) => !current)}
              type="button"
            >
              <span>Projects</span>
              <ChevronDown
                aria-hidden="true"
                className={cn("h-3.5 w-3.5 transition-transform", projectsOpen && "rotate-180")}
              />
            </button>
            {projectsOpen ? (
              <ProjectList
                activeThreadId={activeThreadId}
                deleteMutation={deleteMutation}
                onDelete={onDelete}
                onRename={onRename}
                projects={sidebarProjects}
                renameMutation={renameMutation}
              />
            ) : null}
          </nav>

          <nav aria-label="Workspace" className="mt-4 flex flex-col gap-1 px-1 pb-1">
            {WORKSPACE_SECTION_NAV.map((item) => (
              <SidebarNavRow item={item} key={item.id} pathname={pathname} />
            ))}
          </nav>
        </div>

        <nav aria-label="Cheatcode help" className="px-1 pb-1">
          {FOOTER_NAV.filter((item) => item.id === "cheatcode-101").map((item) => (
            <SidebarHelpCard item={item} key={item.id} pathname={pathname} />
          ))}
        </nav>
      </div>

      <nav
        aria-label="Settings"
        className="relative z-10 mt-auto flex shrink-0 flex-col gap-1 pt-1 pb-2"
      >
        <SidebarSettingsMenu
          onNavigate={onCloseSettings}
          onToggle={onToggleSettings}
          open={settingsOpen}
        />
      </nav>
    </div>
  );
}

function SidebarProfileAvatar({
  brand = false,
  displayName,
  imageUrl,
  initial,
}: {
  brand?: boolean | undefined;
  displayName: string;
  imageUrl: null | string;
  initial: string;
}) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center p-0.5">
      <span className="relative flex size-7 shrink-0 items-center justify-center">
        {brand ? (
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#9ee7ff_0%,#2b8cff_48%,#1749d6_100%)] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.38),0_0_1px_rgba(0,0,0,0.18)]"
          >
            <CheatcodeMark className="size-5" />
          </span>
        ) : imageUrl ? (
          <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white">
            <Image
              alt={displayName}
              className="size-5 rounded-full object-cover"
              height={20}
              referrerPolicy="no-referrer"
              src={imageUrl}
              unoptimized
              width={20}
            />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#f6ce72_0%,#ca7625_46%,#8c2a1d_100%)] text-[11px] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35),0_0_1px_rgba(0,0,0,0.18)]"
          >
            {initial}
          </span>
        )}
      </span>
    </span>
  );
}

function SidebarAccountMenu({
  displayName,
  email,
  getToken,
  onNavigate,
  onSignOut,
}: {
  displayName: string;
  email: null | string;
  getToken: () => Promise<null | string>;
  onNavigate: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="mx-0.5 -mt-0.5 flex shrink-0 flex-col gap-1 p-1 pb-[5px]">
      <div className="flex h-8 min-w-0 items-center gap-2 px-[9px] py-1.5">
        <p className="min-w-0 flex-1 truncate font-medium text-[#5f5f5f] text-[13px] leading-[19.5px]">
          {email ?? displayName}
        </p>
        <Link
          className="shrink-0 font-medium text-[#1b1b1b] text-[11px] leading-[16.5px] transition-opacity hover:opacity-70"
          href="/settings/billing"
          onClick={onNavigate}
        >
          Upgrade
        </Link>
      </div>
      <SidebarCreditsCard getToken={getToken} onNavigate={onNavigate} />
      <div className="flex flex-col gap-1">
        {SIDEBAR_MORE_LINKS.map((item) => (
          <SidebarAccountMenuLink item={item} key={item.label} onNavigate={onNavigate} />
        ))}
        <button
          className="paper-focus-ring flex h-8 w-full items-center rounded-full px-[9px] py-1.5 text-left font-medium text-[#5f5f5f] text-[14px] leading-5 transition-colors hover:bg-white hover:text-[#1b1b1b]"
          onClick={onSignOut}
          type="button"
        >
          <span className="min-w-0 truncate">Log out</span>
        </button>
      </div>
    </div>
  );
}

function SidebarCreditsCard({
  getToken,
  onNavigate,
}: {
  getToken: () => Promise<null | string>;
  onNavigate: () => void;
}) {
  const usageQuery = useSandboxUsageQuery(getToken);
  const usage = usageQuery.data;
  const total = usage?.sandboxHoursTotal ?? 0;
  const used = usage?.sandboxHoursUsed ?? 0;
  const usedRatio = total > 0 ? Math.max(0, Math.min(1, used / total)) : 0;
  const filledBars = Math.round(usedRatio * CREDIT_BAR_KEYS.length);
  const usedLabel = usageQuery.isLoading ? "..." : formatCompactHours(used);

  return (
    <Link
      className="paper-focus-ring flex h-[88px] flex-col gap-2.5 rounded-2xl border border-[#e6e6e6] bg-[#f7f7f7] p-2.5 pt-1 text-left transition-opacity hover:opacity-90"
      href="/settings/billing"
      onClick={onNavigate}
    >
      <div className="flex w-full items-center justify-between">
        <span className="font-medium text-[#1b1b1b] text-[13px] leading-[19.5px]">Credits</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-bold text-[#1b1b1b] text-lg tabular-nums leading-none">
          {usedLabel}
        </span>
        <span className="font-medium text-[#5f5f5f] text-[11px] leading-[16.5px]">used</span>
      </div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden" aria-hidden="true">
        {CREDIT_BAR_KEYS.map((key, index) => (
          <span
            className={cn(
              "h-3 flex-1 rounded-sm",
              index < filledBars ? "bg-[#1b1b1b]" : "bg-[#e6e6e6]",
            )}
            key={key}
          />
        ))}
      </div>
    </Link>
  );
}

function SidebarAccountMenuLink({
  item,
  onNavigate,
}: {
  item: SidebarMenuLinkItem;
  onNavigate: () => void;
}) {
  const external = isExternalHref(item.href);
  const className =
    "paper-focus-ring flex h-8 w-full items-center rounded-full px-[9px] py-1.5 font-medium text-[#5f5f5f] text-[14px] leading-5 transition-colors hover:bg-white hover:text-[#1b1b1b]";

  if (external) {
    return (
      <a
        className={className}
        href={item.href}
        onClick={onNavigate}
        rel={item.href.startsWith("http") ? "noopener noreferrer" : undefined}
        target={item.href.startsWith("http") ? "_blank" : undefined}
      >
        {item.label}
      </a>
    );
  }

  return (
    <Link className={className} href={item.href} onClick={onNavigate}>
      {item.label}
    </Link>
  );
}

function SidebarSettingsMenu({
  onNavigate,
  onToggle,
  open,
}: {
  onNavigate: () => void;
  onToggle: () => void;
  open: boolean;
}) {
  return (
    <>
      <div
        aria-hidden={!open}
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows,opacity,transform,margin-bottom] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transform-none motion-reduce:transition-none",
          open
            ? "mb-1 translate-y-0 grid-rows-[1fr] opacity-100"
            : "mb-0 translate-y-1 grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              "mx-1 rounded-[20px] bg-white px-3 py-3 shadow-[0_1px_0_rgba(0,0,0,0.04),0_8px_22px_rgba(0,0,0,0.04)] transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transform-none motion-reduce:transition-none",
              open ? "translate-y-0" : "translate-y-1",
            )}
          >
            <div className="flex flex-col gap-1">
              {SIDEBAR_MORE_LINKS.map((item) => (
                <SidebarMenuLink
                  interactive={open}
                  item={item}
                  key={item.label}
                  onNavigate={onNavigate}
                  open={open}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <button
        aria-expanded={open}
        className={cn(
          "paper-focus-ring flex min-h-9 w-full items-center gap-2 rounded-full px-[13px] py-1.5 font-medium text-[14px] leading-5 transition-[background-color,color,box-shadow] duration-200 hover:bg-[#f7f7f7] hover:text-[#1b1b1b] motion-reduce:transition-none",
          open ? "bg-white text-[#1b1b1b] shadow-[0_1px_0_rgba(0,0,0,0.03)]" : "text-[#5f5f5f]",
        )}
        onClick={onToggle}
        type="button"
      >
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          <MoreVertical aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 truncate">Settings</span>
      </button>
    </>
  );
}

function SidebarMenuLink({
  interactive = true,
  item,
  onNavigate,
  open = true,
}: {
  interactive?: boolean | undefined;
  item: SidebarMenuLinkItem;
  onNavigate: () => void;
  open?: boolean | undefined;
}) {
  const external = isExternalHref(item.href);
  const content = (
    <>
      <item.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="min-w-0 truncate">{item.label}</span>
    </>
  );
  const className = cn(
    "paper-focus-ring flex h-9 w-full items-center gap-3 rounded-full px-2 font-medium text-[#5f5f5f] text-[14px] leading-5 transition-[background-color,color,opacity,transform] duration-200 ease-out hover:bg-[#f7f7f7] hover:text-[#1b1b1b] motion-reduce:transform-none motion-reduce:transition-none",
    open ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
  );

  if (external) {
    return (
      <a
        className={className}
        href={item.href}
        onClick={onNavigate}
        rel={item.href.startsWith("http") ? "noopener noreferrer" : undefined}
        tabIndex={interactive ? undefined : -1}
        target={item.href.startsWith("http") ? "_blank" : undefined}
      >
        {content}
      </a>
    );
  }

  return (
    <Link
      className={className}
      href={item.href}
      onClick={onNavigate}
      tabIndex={interactive ? undefined : -1}
    >
      {content}
    </Link>
  );
}

function formatCompactHours(value: number): string {
  const formatted = formatHoursUsed(value);
  return formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted;
}

function isExternalHref(href: string): boolean {
  return href.startsWith("http") || href.startsWith("mailto:");
}

/**
 * Active chat id = the last segment of the `/chats/[chatId]` workspace route.
 * Any other route has no active chat, so the sidebar highlights nothing.
 */
function activeChatIdFromPathname(pathname: string): string | null {
  const segments = pathname.split("/");
  if (segments[1] !== "chats") {
    return null;
  }
  const id = segments[2];
  return id ? decodeURIComponent(id) : null;
}

function sidebarBackdropClass(isOverlay: boolean): string {
  return cn(
    "fixed inset-0 z-40 bg-black/10 backdrop-blur-sm",
    isOverlay ? "md:bg-transparent md:backdrop-blur-none" : "md:hidden",
  );
}

function sidebarTransformClass(isOverlay: boolean, sidebarOpen: boolean): string {
  if (sidebarOpen) {
    return "translate-x-0";
  }
  return isOverlay
    ? "-translate-x-[calc(100%+1rem)]"
    : "-translate-x-[calc(100%+1rem)] md:translate-x-0";
}

function SidebarRailContent({ onExpand, pathname }: { onExpand: () => void; pathname: string }) {
  const items = [...PRIMARY_NAV, ...WORKSPACE_SECTION_NAV, ...FOOTER_NAV].filter(
    (item) => item.id !== "cheatcode-101" && item.id !== "settings",
  );
  const settingsItem = FOOTER_NAV.find((item) => item.id === "settings");

  return (
    <div className="flex size-full flex-col overflow-hidden rounded-[20.5px]">
      <div className="flex h-[57px] shrink-0 items-start justify-center pt-2">
        <button
          aria-label="Expand sidebar"
          className="paper-focus-ring flex size-7 items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-white hover:text-[#1b1b1b]"
          onClick={onExpand}
          title="Expand sidebar"
          type="button"
        >
          <PanelLeftOpen aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <nav aria-label="Workspace rail" className="flex flex-1 flex-col gap-1 px-1 pb-1">
        {items.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <Link
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "paper-focus-ring flex h-8 w-full shrink-0 items-center rounded-full px-[9px] transition-colors",
                active
                  ? "bud-lifted-surface bg-white text-[#1b1b1b]"
                  : "text-[#5f5f5f] hover:bg-white hover:text-[#1b1b1b]",
              )}
              href={item.target.href}
              key={item.id}
            >
              <item.icon aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          );
        })}
      </nav>
      {settingsItem ? (
        <Link
          aria-label="Settings"
          aria-current={isNavItemActive(settingsItem, pathname) ? "page" : undefined}
          className={cn(
            "paper-focus-ring flex min-h-8 w-full items-center px-[13px] py-1.5 transition-colors",
            isNavItemActive(settingsItem, pathname)
              ? "text-[#1b1b1b]"
              : "text-[#5f5f5f] hover:text-[#1b1b1b]",
          )}
          href={settingsItem.target.href}
          title="Settings"
        >
          <MoreVertical aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

function IconRail({ onExpand }: { onExpand: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="fixed top-2 bottom-2 left-2 z-40 hidden max-h-[calc(100vh-16px)] w-12 flex-col items-center overflow-hidden rounded-[24px] border-2 border-[#f7f7f7] bg-transparent p-0.5 md:flex">
      <SidebarRailContent onExpand={onExpand} pathname={pathname} />
    </aside>
  );
}

function SidebarNavRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavItemActive(item, pathname);
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "paper-focus-ring flex h-8 w-full shrink-0 items-center gap-2 rounded-full px-[9px] font-medium text-[14px] leading-5 transition-colors",
        active ? "bg-white text-[#1b1b1b]" : "text-[#5f5f5f] hover:bg-white hover:text-[#1b1b1b]",
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

function SidebarHelpCard({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavItemActive(item, pathname);
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "paper-focus-ring bud-lifted-surface flex min-h-14 w-full items-start gap-2 rounded-2xl px-[9px] py-2 text-left transition-colors hover:text-[#1b1b1b]",
        active ? "text-[#1b1b1b]" : "text-[#5f5f5f]",
      )}
      href={item.target.href}
    >
      <item.icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-[14px] leading-5">{item.label}</span>
        <span className="block truncate text-[#8a8a8a] text-[12px] leading-4">
          {item.description ?? "Learn what Cheatcode can do"}
        </span>
      </span>
    </Link>
  );
}

/**
 * Shared chat rename/delete actions (mutations + confirm/rename dialogs), used by
 * both the flat "Chats" list and the nested project→chats folders so per-chat
 * affordances stay identical everywhere. Returns the dialog elements to render.
 */
function useChatActions(activeThreadId: string | null) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [pendingDelete, setPendingDelete] = useState<SidebarChat | null>(null);
  const [pendingRename, setPendingRename] = useState<SidebarChat | null>(null);

  const invalidateChats = () => {
    void queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] });
    void queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
  };
  const deleteMutation = useMutation({
    mutationFn: (chat: SidebarChat) => deleteThread(getToken, chat.id),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Chat delete failed");
    },
    onSettled: () => setPendingDelete(null),
    onSuccess: (_result, chat) => {
      toast.success("Chat deleted");
      invalidateChats();
      if (activeThreadId === chat.id) {
        router.push("/");
      }
    },
  });
  const renameMutation = useMutation({
    mutationFn: ({ chat, title }: { chat: SidebarChat; title: string }) =>
      updateThread(getToken, chat.id, { title }),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Chat rename failed");
    },
    onSettled: () => setPendingRename(null),
    onSuccess: (result) => {
      toast.success(`Renamed to ${result.title ?? "New chat"}`);
      invalidateChats();
    },
  });

  const dialogs = (
    <>
      <ConfirmDialog
        busy={deleteMutation.isPending}
        cancelLabel="Cancel"
        confirmLabel="Delete chat"
        description="This removes the chat and its messages. The project and its files stay."
        destructive
        id="sidebar-delete-chat-dialog"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            deleteMutation.mutate(pendingDelete);
          }
        }}
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete ${pendingDelete.title || "New chat"}?` : "Delete chat?"}
      />
      <RenameDialog
        busy={renameMutation.isPending}
        heading="Rename chat"
        initialName={pendingRename?.title ?? ""}
        inputAriaLabel="Chat name"
        onCancel={() => setPendingRename(null)}
        onSubmit={(title) => {
          if (pendingRename) {
            renameMutation.mutate({ chat: pendingRename, title });
          }
        }}
        open={pendingRename !== null}
      />
    </>
  );

  return {
    dialogs,
    isDeleting: (id: string) => deleteMutation.isPending && deleteMutation.variables?.id === id,
    isRenaming: (id: string) =>
      renameMutation.isPending && renameMutation.variables?.chat.id === id,
    onDelete: setPendingDelete,
    onRename: setPendingRename,
  };
}

function ChatList({
  activeThreadId,
  chats,
}: {
  activeThreadId: string | null;
  chats: ReturnType<typeof useSidebarChats>;
}) {
  const actions = useChatActions(activeThreadId);

  if (chats.isLoading) {
    return <ProjectSkeletonRows />;
  }
  if (chats.items.length === 0) {
    return <div className="px-2 py-2 text-[#a0a0a0] text-[12px]">No chats yet</div>;
  }
  return (
    <>
      <div className="space-y-1 py-1">
        {chats.items.slice(0, 12).map((chat) => (
          <ChatRow
            activeThreadId={activeThreadId}
            chat={{ activeRunId: chat.activeRunId ?? null, id: chat.id, title: chat.title }}
            isDeleting={actions.isDeleting(chat.id)}
            isRenaming={actions.isRenaming(chat.id)}
            key={chat.id}
            onDelete={actions.onDelete}
            onRename={actions.onRename}
          />
        ))}
      </div>
      {actions.dialogs}
    </>
  );
}

function ChatRow({
  activeThreadId,
  chat,
  isDeleting,
  isRenaming,
  onDelete,
  onRename,
}: {
  activeThreadId: string | null;
  chat: SidebarChat;
  isDeleting: boolean;
  isRenaming: boolean;
  onDelete: (chat: SidebarChat) => void;
  onRename: (chat: SidebarChat) => void;
}) {
  const isActive = activeThreadId === chat.id;
  // Non-null while a run is in flight — mirrors bud's trailing running-chat spinner.
  const isRunning = Boolean(chat.activeRunId);
  return (
    <div className="group/row relative">
      <Link
        className={cn(
          "relative flex h-8 w-full items-center gap-2 rounded-full px-[9px] text-left font-medium text-[13px] leading-[19.5px] transition-colors",
          isActive
            ? "bg-white text-[#1b1b1b]"
            : "text-[#5f5f5f] hover:bg-white hover:text-[#1b1b1b]",
        )}
        href={`/chats/${encodeURIComponent(chat.id)}`}
      >
        <span className="min-w-0 flex-1 truncate pr-12">{chat.title || "New chat"}</span>
        {isRunning ? (
          <Loader2
            aria-label="Run in progress"
            className="h-3.5 w-3.5 shrink-0 animate-spin text-[#f8af2c] transition-opacity group-hover/row:opacity-0"
            role="img"
          />
        ) : null}
      </Link>
      <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover/row:opacity-100">
        <button
          aria-label={`Rename ${chat.title || "chat"}`}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-[#a0a0a0] transition-colors hover:bg-white hover:text-[#1b1b1b] disabled:cursor-not-allowed disabled:opacity-45",
            isRenaming && "text-[#1b1b1b]",
          )}
          disabled={isRenaming}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRename(chat);
          }}
          type="button"
        >
          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
        <button
          aria-label={`Delete ${chat.title || "chat"}`}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-[#a0a0a0] transition-colors hover:bg-white hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-45",
            isDeleting && "text-red-600",
          )}
          disabled={isDeleting}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete(chat);
          }}
          type="button"
        >
          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ProjectList({
  activeThreadId,
  deleteMutation,
  onDelete,
  onRename,
  projects,
  renameMutation,
}: {
  activeThreadId: string | null;
  deleteMutation: { isPending: boolean; variables?: SidebarProject | undefined };
  onDelete: (project: SidebarProject) => void;
  onRename: (project: SidebarProject) => void;
  projects: ReturnType<typeof useSidebarProjects>;
  renameMutation: {
    isPending: boolean;
    variables?: { name: string; project: SidebarProject } | undefined;
  };
}) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const chatActions = useChatActions(activeThreadId);
  const newChatMutation = useMutation({
    mutationFn: (projectId: string) => createChat(getToken, { projectId }),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Couldn't start a chat");
    },
    onSuccess: (thread) => {
      void queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] });
      router.push(`/chats/${encodeURIComponent(thread.id)}`);
    },
  });

  if (projects.isLoading) {
    return <ProjectSkeletonRows />;
  }
  if (projects.items.length === 0) {
    return <div className="px-2 py-2 text-[#a0a0a0] text-[12px]">No projects yet</div>;
  }
  return (
    <>
      <div className="space-y-1 py-1">
        {projects.items.slice(0, 6).map((project) => (
          <ProjectRow
            activeThreadId={activeThreadId}
            chatActions={chatActions}
            isCreatingChat={newChatMutation.isPending && newChatMutation.variables === project.id}
            isDeleting={deleteMutation.isPending && deleteMutation.variables?.id === project.id}
            isRenaming={
              renameMutation.isPending && renameMutation.variables?.project.id === project.id
            }
            key={project.id}
            onDelete={onDelete}
            onNewChat={(projectId) => newChatMutation.mutate(projectId)}
            onRename={onRename}
            project={project}
          />
        ))}
      </div>
      {chatActions.dialogs}
    </>
  );
}

function ProjectRow({
  activeThreadId,
  chatActions,
  isCreatingChat,
  isDeleting,
  isRenaming,
  onDelete,
  onNewChat,
  onRename,
  project,
}: {
  activeThreadId: string | null;
  chatActions: ReturnType<typeof useChatActions>;
  isCreatingChat: boolean;
  isDeleting: boolean;
  isRenaming: boolean;
  onDelete: (project: SidebarProject) => void;
  onNewChat: (projectId: string) => void;
  onRename: (project: SidebarProject) => void;
  project: SidebarProject;
}) {
  const [expanded, setExpanded] = useState(false);
  const projectHref = project.href;
  const hasThreads = project.threads.length > 0;
  const isActive = project.threads.some((thread) => thread.id === activeThreadId);
  const Icon = project.appType === "mobile" ? Smartphone : Monitor;
  const rowClassName = cn(
    "relative flex h-8 w-full items-center gap-1 rounded-full pr-[9px] pl-1 text-left font-medium text-[13px] leading-[19.5px] transition-colors",
    isActive ? "bg-white text-[#1b1b1b]" : "text-[#5f5f5f] hover:bg-white hover:text-[#1b1b1b]",
  );

  return (
    <div>
      <div className="group/row relative">
        <div className={rowClassName}>
          {hasThreads ? (
            <button
              aria-label={expanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#a0a0a0] transition-colors hover:text-[#1b1b1b]"
              onClick={() => setExpanded((value) => !value)}
              type="button"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
              />
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          {projectHref ? (
            <Link className="flex min-w-0 flex-1 items-center gap-2" href={projectHref}>
              <ProjectRowContent Icon={Icon} project={project} />
            </Link>
          ) : (
            <div className="flex min-w-0 flex-1 cursor-default items-center gap-2">
              <ProjectRowContent Icon={Icon} project={project} />
            </div>
          )}
        </div>
        <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover/row:opacity-100">
          {projectHref ? (
            <>
              <button
                aria-label={`Copy link to ${project.name}`}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[#a0a0a0] transition-colors hover:bg-white hover:text-[#1b1b1b]"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  copyProjectLink(projectHref, project.name);
                }}
                type="button"
              >
                <LinkIcon aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
              <a
                aria-label={`Open ${project.name} in a new tab`}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[#a0a0a0] transition-colors hover:bg-white hover:text-[#1b1b1b]"
                href={projectHref}
                onClick={(event) => event.stopPropagation()}
                rel="noopener noreferrer"
                target="_blank"
              >
                <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
              </a>
            </>
          ) : null}
          <button
            aria-label={`Rename ${project.name}`}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-[#a0a0a0] transition-colors hover:bg-white hover:text-[#1b1b1b] disabled:cursor-not-allowed disabled:opacity-45",
              isRenaming && "text-[#1b1b1b]",
            )}
            disabled={isRenaming}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRename(project);
            }}
            type="button"
          >
            <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
          <button
            aria-label={`Delete ${project.name}`}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-[#a0a0a0] transition-colors hover:bg-white hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-45",
              isDeleting && "text-red-600",
            )}
            disabled={isDeleting}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDelete(project);
            }}
            type="button"
          >
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
          <span className="hidden h-6 w-6 items-center justify-center text-[#c7c7c7] md:flex">
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
          </span>
        </div>
      </div>
      {expanded ? (
        <div className="mt-0.5 ml-[18px] flex flex-col gap-0.5 border-[#ededed] border-l pl-2">
          {project.threads.map((chat) => (
            <ChatRow
              activeThreadId={activeThreadId}
              chat={chat}
              isDeleting={chatActions.isDeleting(chat.id)}
              isRenaming={chatActions.isRenaming(chat.id)}
              key={chat.id}
              onDelete={chatActions.onDelete}
              onRename={chatActions.onRename}
            />
          ))}
          <button
            className="flex h-7 w-full items-center gap-2 rounded-full px-[9px] text-left font-medium text-[#8a8a8a] text-[12px] transition-colors hover:bg-white hover:text-[#1b1b1b] disabled:opacity-50"
            disabled={isCreatingChat}
            onClick={() => onNewChat(project.id)}
            type="button"
          >
            {isCreatingChat ? (
              <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            <span>New chat</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ProjectRowContent({ Icon, project }: { Icon: typeof Monitor; project: SidebarProject }) {
  return (
    <>
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate pr-16">{project.name}</span>
    </>
  );
}

function ProjectSkeletonRows() {
  return (
    <div className="space-y-1 py-1">
      {["one", "two", "three"].map((key) => (
        <div className="mx-2 h-7 animate-pulse rounded-full bg-[#f7f7f7]" key={key} />
      ))}
    </div>
  );
}

function MobileSidebarButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      aria-label="Open sidebar"
      className="fixed top-3 left-3 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-[#f1f1f1] bg-white text-[#1b1b1b] shadow-sm md:hidden"
      onClick={onClick}
      type="button"
    >
      <Menu aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

function RenameDialog({
  busy,
  heading,
  initialName,
  inputAriaLabel,
  onCancel,
  onSubmit,
  open,
}: {
  busy: boolean;
  heading: string;
  initialName: string;
  inputAriaLabel: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
  open: boolean;
}) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (open) {
      setDraft(initialName);
    }
  }, [open, initialName]);
  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 120 && trimmed !== initialName;
  const titleId = "sidebar-rename-dialog-title";

  return (
    <ModalShell
      labelledBy={titleId}
      onClose={() => {
        if (!busy) {
          onCancel();
        }
      }}
      open={open}
    >
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && !busy) {
            onSubmit(trimmed);
          }
        }}
      >
        <h2 className="font-semibold text-base text-foreground" id={titleId}>
          {heading}
        </h2>
        <input
          aria-label={inputAriaLabel}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-foreground text-sm outline-none focus:border-foreground/40"
          disabled={busy}
          maxLength={120}
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
        <div className="flex justify-end gap-2">
          <button
            className="rounded-md border border-border px-3 py-1.5 text-foreground text-sm hover:bg-muted disabled:opacity-50"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
            disabled={busy || !canSubmit}
            type="submit"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function navItems(section: NavItem["section"]): NavItem[] {
  return WORKSPACE_NAV.filter((item) => item.section === section && item.status === "active");
}

function useSidebarChats(getToken: () => Promise<null | string>, enabled: boolean) {
  const { data, isPending } = useQuery({
    enabled,
    queryFn: () => listRecentThreads(getToken, 20),
    queryKey: ["sidebar-chats"],
    retry: false,
    staleTime: 30_000,
  });
  return {
    isLoading: enabled && isPending,
    items: enabled ? (data ?? []) : [],
  };
}

function useSidebarProjects(getToken: () => Promise<null | string>, enabled: boolean) {
  const {
    data: projectData,
    isPending: projectsIsPending,
    isSuccess: projectsIsSuccess,
  } = useQuery({
    enabled,
    queryFn: () => listProjects(getToken),
    queryKey: ["sidebar-projects"],
    retry: false,
    staleTime: 30_000,
  });
  const projects = enabled ? (projectData ?? []) : [];
  const threadQueries = useQueries({
    queries: projects.map((project) => ({
      enabled: enabled && projectsIsSuccess,
      queryFn: () => listProjectThreads(getToken, project.id),
      queryKey: ["sidebar-project-threads", project.id] as const,
      retry: false,
      staleTime: 30_000,
    })),
  });
  const items = projects.map((project, index) =>
    sidebarProjectFromApi(project, threadQueries[index]?.data ?? []),
  );

  return {
    isLoading: enabled && (projectsIsPending || threadQueries.some((query) => query.isPending)),
    items,
  };
}

function sidebarProjectFromApi(project: ProjectSummary, threads: Thread[]): SidebarProject {
  const newest = threads[0] ?? null;
  return {
    appType: sidebarAppType(project.mode),
    href: newest ? `/chats/${encodeURIComponent(newest.id)}` : null,
    id: project.id,
    name: project.name,
    threadId: newest?.id ?? null,
    threads: threads.map((thread) => ({
      activeRunId: thread.activeRunId,
      id: thread.id,
      title: thread.title,
    })),
  };
}

function copyProjectLink(href: string, projectName: string) {
  const url = `${window.location.origin}${href}`;
  void navigator.clipboard
    .writeText(url)
    .then(() => toast.success(`Copied ${projectName} link`))
    .catch(() => toast.error("Failed to copy link"));
}

function sidebarAppType(mode: string): "general" | "mobile" | "web" {
  if (mode === "app-builder-mobile") {
    return "mobile";
  }
  return mode === "app-builder" ? "web" : "general";
}
