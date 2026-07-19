"use client";

import { Search } from "@cheatcode/ui";
import Image from "next/image";
import Link from "next/link";
import type { AuthMode } from "@/components/auth/auth-modal";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/components/search/command-palette-event";
import { SidebarPanelToggleIcon } from "@/components/shell/sidebar-nav-icons";
import { isExternalHref } from "@/components/shell/sidebar-navigation-model";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import { formatHoursUsed, useSandboxUsageQuery } from "@/lib/hooks/use-billing";
import { cn } from "@/lib/ui/cn";

const USAGE_BAR_KEYS = Array.from({ length: 50 }, (_, index) => `usage-bar-${index}`);
const USAGE_RING_CIRCUMFERENCE = 2 * Math.PI * 10;
const CHEATCODE_ACCOUNT_FONT = 'circular, "circular Fallback", sans-serif';
const CHEATCODE_ACCOUNT_AMOUNT_FONT = "Inter, var(--font-geist-sans), sans-serif";
const ACCOUNT_DROPDOWN_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/usage", label: "Usage" },
] as const satisfies readonly SidebarAccountLink[];

type SidebarAccountLink = { href: string; label: string };

interface SidebarSandboxUsage {
  filledBars: number;
  percentLabel: string;
  progressLength: number;
  usedLabel: string;
}

interface SidebarAccountSectionProps {
  displayName: string;
  email: null | string;
  getToken: () => Promise<null | string>;
  imageUrl: null | string;
  isLoaded: boolean;
  isOpen: boolean;
  isOverlay: boolean;
  isSignedIn: boolean;
  onAuthModeChange: (mode: AuthMode) => void;
  onClose: () => void;
  onCollapse: () => void;
  onSignOut: () => void;
  onToggle: () => void;
}

export function SidebarAccountSection(props: SidebarAccountSectionProps) {
  const usage = useSidebarSandboxUsage(props.getToken, props.isSignedIn);
  return (
    <div className="flex shrink-0 items-center p-0.5">
      <div
        className={cn(
          "flex w-full flex-col rounded-[19px] transition-colors duration-200",
          props.isOpen && props.isSignedIn ? "bg-background dark:bg-white/5" : "bg-transparent",
        )}
        style={{ fontFamily: CHEATCODE_ACCOUNT_FONT }}
      >
        <SidebarAccountHeader {...props} usage={usage} />
        <SidebarAccountDisclosure {...props} usage={usage} />
      </div>
    </div>
  );
}

function SidebarAccountHeader(props: SidebarAccountSectionProps & { usage: SidebarSandboxUsage }) {
  return (
    <div className="flex w-full items-center justify-between gap-2 overflow-hidden p-0.5">
      {props.isLoaded && !props.isSignedIn ? (
        <SidebarSignInButton onAuthModeChange={props.onAuthModeChange} />
      ) : (
        <SidebarIdentityButton {...props} />
      )}
      {props.isOverlay ? null : <SidebarHeaderActions onCollapse={props.onCollapse} />}
    </div>
  );
}

function SidebarSignInButton({ onAuthModeChange }: { onAuthModeChange: (mode: AuthMode) => void }) {
  return (
    <button
      aria-label="Sign in to Cheatcode"
      className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md font-medium text-[14px] text-foreground leading-5 transition-opacity hover:opacity-80"
      onClick={() => onAuthModeChange("sign-in")}
      type="button"
    >
      <SidebarBrandAvatar />
      <span className="min-w-0 truncate">cheatcode</span>
    </button>
  );
}

function SidebarIdentityButton(props: SidebarAccountSectionProps & { usage: SidebarSandboxUsage }) {
  return (
    <button
      aria-label={`Account: ${props.displayName}`}
      aria-expanded={props.isOpen}
      className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md font-medium text-[14px] text-foreground leading-5 transition-opacity hover:opacity-80"
      onClick={props.onToggle}
      title={props.displayName}
      type="button"
    >
      <SidebarUserAvatar
        displayName={props.displayName}
        imageUrl={props.imageUrl}
        usage={props.usage}
      />
      <span className="min-w-0 truncate text-left">{props.displayName}</span>
    </button>
  );
}

function SidebarHeaderActions({ onCollapse }: { onCollapse: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <CheatcodeTooltip label="Search" shortcut={["⌘", "K"]} side="bottom">
        <button
          aria-label="Search"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-fg-secondary transition-[background-color,color,transform] duration-150 ease-out hover:bg-background hover:text-foreground active:scale-[0.97] motion-reduce:transition-none dark:hover:bg-white/5"
          onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
          type="button"
        >
          <Search aria-hidden="true" className="h-4 w-4" />
        </button>
      </CheatcodeTooltip>
      <SidebarCollapseButton onCollapse={onCollapse} />
    </div>
  );
}

function SidebarCollapseButton({ onCollapse }: { onCollapse: () => void }) {
  return (
    <CheatcodeTooltip label="Collapse sidebar" side="bottom">
      <button
        aria-label="Collapse sidebar"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-fg-secondary transition-[background-color,color,transform] duration-150 ease-out hover:bg-background hover:text-foreground active:scale-[0.97] motion-reduce:transition-none dark:hover:bg-white/5"
        onClick={onCollapse}
        type="button"
      >
        <SidebarPanelToggleIcon expanded />
      </button>
    </CheatcodeTooltip>
  );
}

function SidebarAccountDisclosure(
  props: SidebarAccountSectionProps & { usage: SidebarSandboxUsage },
) {
  if (!props.isSignedIn) return null;
  return (
    <div
      aria-hidden={!props.isOpen}
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
        props.isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      inert={props.isOpen ? undefined : true}
    >
      <div className="min-h-0 overflow-hidden">
        <SidebarAccountMenu
          displayName={props.displayName}
          email={props.email}
          onNavigate={props.onClose}
          onSignOut={props.onSignOut}
          usage={props.usage}
        />
      </div>
    </div>
  );
}

function SidebarBrandAvatar() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center p-0.5">
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#9ee7ff_0%,#2b8cff_48%,#1749d6_100%)] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.38),0_0_1px_rgba(0,0,0,0.18)]"
      >
        <CheatcodeMark className="size-5" />
      </span>
    </span>
  );
}

function SidebarUserAvatar({
  displayName,
  imageUrl,
  usage,
}: {
  displayName: string;
  imageUrl: null | string;
  usage: SidebarSandboxUsage;
}) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center p-0.5">
      <span className="group relative flex size-7 shrink-0 items-center justify-center">
        <SidebarUsageRing progressLength={usage.progressLength} />
        <SidebarAvatarImage displayName={displayName} imageUrl={imageUrl} />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-1 flex items-center justify-center rounded-full bg-background font-semibold text-[9px] text-foreground tabular-nums leading-none opacity-0 transition-opacity duration-150 group-hover:opacity-100 motion-reduce:transition-none"
        >
          {usage.percentLabel}
        </span>
      </span>
    </span>
  );
}

function SidebarUsageRing({ progressLength }: { progressLength: number }) {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 size-7 shrink-0 -rotate-90"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" fill="none" r="10" stroke="var(--border-tree)" strokeWidth="1.5" />
      <circle
        cx="12"
        cy="12"
        fill="none"
        r="10"
        stroke="#f8af2c"
        strokeDasharray={`${progressLength} ${USAGE_RING_CIRCUMFERENCE}`}
        strokeLinecap="round"
        strokeWidth="1.5"
        style={{ transition: "stroke-dasharray 800ms ease-out" }}
      />
    </svg>
  );
}

function SidebarAvatarImage({
  displayName,
  imageUrl,
}: {
  displayName: string;
  imageUrl: null | string;
}) {
  if (!imageUrl) {
    return (
      <span
        aria-hidden="true"
        className="flex size-5 items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#9ee7ff_0%,#2b8cff_48%,#1749d6_100%)] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.38),0_0_1px_rgba(0,0,0,0.18)] transition-opacity duration-150 group-hover:opacity-0 motion-reduce:transition-none"
      >
        <CheatcodeMark className="size-3.5" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-background transition-opacity duration-150 group-hover:opacity-0 motion-reduce:transition-none">
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
  );
}

function SidebarAccountMenu({
  displayName,
  email,
  onNavigate,
  onSignOut,
  usage,
}: {
  displayName: string;
  email: null | string;
  onNavigate: () => void;
  onSignOut: () => void;
  usage: SidebarSandboxUsage;
}) {
  return (
    <div
      className="flex shrink-0 flex-col gap-0.5 p-1 pb-[5px]"
      style={{ fontFamily: CHEATCODE_ACCOUNT_FONT }}
    >
      <SidebarAccountSummary displayName={displayName} email={email} onNavigate={onNavigate} />
      <SidebarSandboxUsageCard onNavigate={onNavigate} usage={usage} />
      <div className="flex flex-col gap-0.5">
        {ACCOUNT_DROPDOWN_LINKS.map((item) => (
          <SidebarAccountMenuLink item={item} key={item.label} onNavigate={onNavigate} />
        ))}
        <button
          className="flex h-8 w-full items-center rounded-full px-[9px] py-1.5 text-left font-medium text-[14px] text-fg-secondary leading-5 transition-colors hover:bg-secondary hover:text-foreground"
          onClick={onSignOut}
          type="button"
        >
          <span className="min-w-0 truncate">Log out</span>
        </button>
      </div>
    </div>
  );
}

function SidebarAccountSummary({
  displayName,
  email,
  onNavigate,
}: {
  displayName: string;
  email: null | string;
  onNavigate: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-[9px] py-1.5">
      <p className="min-w-0 flex-1 truncate font-medium text-[13px] text-fg-secondary leading-[19.5px]">
        {email ?? displayName}
      </p>
      <Link
        className="shrink-0 font-medium text-[11px] text-foreground leading-[16.5px] transition-opacity hover:opacity-70"
        href="/usage"
        onClick={onNavigate}
      >
        Manage
      </Link>
    </div>
  );
}

function SidebarSandboxUsageCard({
  onNavigate,
  usage,
}: {
  onNavigate: () => void;
  usage: SidebarSandboxUsage;
}) {
  return (
    <Link
      className="flex h-[87px] w-full flex-col gap-2.5 rounded-2xl border border-border bg-secondary p-2.5 pt-1 text-left transition-opacity hover:opacity-90"
      href="/usage"
      onClick={onNavigate}
    >
      <div className="flex w-full items-center justify-between">
        <span className="font-medium text-[13px] text-foreground leading-[19.5px]">
          Sandbox hours
        </span>
      </div>
      <div
        className="flex items-baseline gap-1.5"
        style={{ fontFamily: CHEATCODE_ACCOUNT_AMOUNT_FONT }}
      >
        <span className="font-bold text-foreground text-lg tabular-nums leading-none">
          {usage.usedLabel}
        </span>
        <span className="font-medium text-[11px] text-fg-secondary leading-[16.5px]">used</span>
      </div>
      <div aria-hidden="true" className="flex h-3 w-full gap-0.5 overflow-hidden">
        {USAGE_BAR_KEYS.map((key, index) => (
          <span
            className={cn(
              "h-3 flex-1 rounded-sm transition-[background-color,opacity] duration-200 ease-out motion-reduce:transition-none",
              index < usage.filledBars ? "bg-primary" : "bg-border-tree",
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
  item: SidebarAccountLink;
  onNavigate: () => void;
}) {
  const external = isExternalHref(item.href);
  const className =
    "flex h-8 w-full items-center rounded-full px-[9px] py-1.5 font-medium text-fg-secondary text-[14px] leading-5 transition-colors hover:bg-secondary hover:text-foreground";
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

function useSidebarSandboxUsage(
  getToken: () => Promise<null | string>,
  enabled: boolean,
): SidebarSandboxUsage {
  const usageQuery = useSandboxUsageQuery(getToken, enabled);
  const total = usageQuery.data?.sandboxHoursTotal ?? 0;
  const used = usageQuery.data?.sandboxHoursUsed ?? 0;
  const exactRatio = total > 0 ? Math.max(0, Math.min(1, used / total)) : 0;
  const visibleRatio = used > 0 ? Math.max(exactRatio, 1 / USAGE_BAR_KEYS.length) : 0;
  const exactPercent = exactRatio * 100;
  return {
    filledBars: Math.ceil(visibleRatio * USAGE_BAR_KEYS.length),
    percentLabel: used > 0 && exactPercent < 1 ? "<1%" : `${Math.round(exactPercent)}%`,
    progressLength: visibleRatio * USAGE_RING_CIRCUMFERENCE,
    usedLabel: usageQuery.isLoading ? "..." : formatCompactHours(used),
  };
}

function formatCompactHours(value: number): string {
  const formatted = formatHoursUsed(value);
  return formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted;
}
