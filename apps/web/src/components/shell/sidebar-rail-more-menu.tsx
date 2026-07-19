"use client";

import { CreditCard, LifeBuoy, type LucideIcon, MoreVertical, TrendingUp } from "@cheatcode/ui";
import Link from "next/link";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { FOOTER_NAV, isExternalHref } from "@/components/shell/sidebar-navigation-model";
import { SidebarRailLink } from "@/components/shell/sidebar-rail-navigation";
import {
  SidebarDarkThemeIcon,
  SidebarLightThemeIcon,
  SidebarSystemThemeIcon,
} from "@/components/shell/sidebar-settings-icons";
import { useSidebarTheme } from "@/components/shell/sidebar-theme";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import { cn } from "@/lib/ui/cn";

const HELP_ITEM = FOOTER_NAV.find((item) => item.id === "cheatcode-101");
const RAIL_SETTINGS_MENU_LINKS = [
  { href: "/pricing", icon: CreditCard, label: "Pricing" },
  { href: "/usage", icon: TrendingUp, label: "Usage" },
  { href: "mailto:hi@trycheatcode.com", icon: LifeBuoy, label: "Support" },
] as const satisfies readonly SidebarMenuLinkItem[];
const SIDEBAR_THEME_OPTIONS = [
  { icon: SidebarSystemThemeIcon, label: "System theme", value: "system" },
  { icon: SidebarLightThemeIcon, label: "Light theme", value: "light" },
  { icon: SidebarDarkThemeIcon, label: "Dark theme", value: "dark" },
] as const;

type SidebarMenuLinkItem = { href: string; icon: LucideIcon; label: string };

export function SidebarRailMoreMenu({ pathname }: { pathname: string }) {
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  useDismissibleRailMenu(menuRef, open, setOpen);
  return (
    <div className="relative z-10 mt-auto flex shrink-0 flex-col" ref={menuRef}>
      <SidebarRailMoreDisclosure
        menuId={menuId}
        onClose={() => setOpen(false)}
        open={open}
        pathname={pathname}
      />
      <SidebarRailMoreButton menuId={menuId} open={open} setOpen={setOpen} />
    </div>
  );
}

function SidebarRailMoreDisclosure({
  menuId,
  onClose,
  open,
  pathname,
}: {
  menuId: string;
  onClose: () => void;
  open: boolean;
  pathname: string;
}) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      id={menuId}
      inert={open ? undefined : true}
    >
      <nav aria-label="More" className="min-h-0 overflow-hidden px-1 pt-1">
        <div className="flex flex-col gap-0.5">
          {HELP_ITEM ? (
            <SidebarRailLink item={HELP_ITEM} onNavigate={onClose} pathname={pathname} />
          ) : null}
          {RAIL_SETTINGS_MENU_LINKS.map((item) => (
            <SidebarRailMenuLink
              item={item}
              key={item.label}
              onNavigate={onClose}
              pathname={pathname}
            />
          ))}
          <SidebarRailThemeButtons />
        </div>
      </nav>
    </div>
  );
}

function SidebarRailMoreButton({
  menuId,
  open,
  setOpen,
}: {
  menuId: string;
  open: boolean;
  setOpen: (open: boolean | ((current: boolean) => boolean)) => void;
}) {
  return (
    <CheatcodeTooltip className="w-full" disabled={open} label="More" side="right">
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-label="More"
        className={cn(
          "flex min-h-8 w-full items-center bg-background px-[13px] py-1.5 transition-[color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none",
          open ? "text-foreground" : "text-fg-secondary hover:text-foreground",
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <MoreVertical aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </CheatcodeTooltip>
  );
}

function SidebarRailThemeButtons() {
  const { activeTheme, setTheme } = useSidebarTheme();
  return SIDEBAR_THEME_OPTIONS.map((option) => (
    <CheatcodeTooltip className="w-full" key={option.value} label={option.label} side="right">
      <button
        aria-label={option.label}
        aria-pressed={activeTheme === option.value}
        className={cn(
          "flex h-8 w-full cursor-pointer items-center justify-center rounded-full transition-colors",
          activeTheme === option.value
            ? "bg-secondary text-foreground"
            : "text-fg-secondary hover:bg-secondary hover:text-foreground",
        )}
        onClick={() => setTheme(option.value)}
        type="button"
      >
        <option.icon className="size-3.5" />
      </button>
    </CheatcodeTooltip>
  ));
}

function SidebarRailMenuLink({
  item,
  onNavigate,
  pathname,
}: {
  item: SidebarMenuLinkItem;
  onNavigate: () => void;
  pathname: string;
}) {
  const external = isExternalHref(item.href);
  const active = !external && pathname === item.href;
  const className = cn(
    "flex h-8 w-full shrink-0 items-center rounded-full px-[9px] transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none",
    active
      ? "cheatcode-lifted-surface bg-background text-foreground dark:bg-white/5"
      : "text-fg-secondary hover:bg-background hover:text-foreground dark:hover:bg-white/5",
  );
  const content = <item.icon aria-hidden="true" className="h-3.5 w-3.5 [stroke-width:2.25]" />;
  if (external) {
    return (
      <CheatcodeTooltip className="w-full" label={item.label} side="right">
        <a aria-label={item.label} className={className} href={item.href} onClick={onNavigate}>
          {content}
        </a>
      </CheatcodeTooltip>
    );
  }
  return (
    <CheatcodeTooltip className="w-full" label={item.label} side="right">
      <Link
        aria-current={active ? "page" : undefined}
        aria-label={item.label}
        className={className}
        href={item.href}
        onClick={onNavigate}
      >
        {content}
      </Link>
    </CheatcodeTooltip>
  );
}

function useDismissibleRailMenu(
  menuRef: RefObject<HTMLDivElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuRef, open, setOpen]);
}
