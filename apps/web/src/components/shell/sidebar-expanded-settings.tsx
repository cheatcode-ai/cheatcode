"use client";

import { LifeBuoy, MoreVertical } from "@cheatcode/ui";
import Link from "next/link";
import { isExternalHref } from "@/components/shell/sidebar-navigation-model";
import {
  SidebarDarkThemeIcon,
  SidebarLightThemeIcon,
  SidebarPricingIcon,
  SidebarSystemThemeIcon,
  SidebarUsageIcon,
} from "@/components/shell/sidebar-settings-icons";
import { useSidebarTheme } from "@/components/shell/sidebar-theme";
import { cn } from "@/lib/ui/cn";

const SETTINGS_MENU_LINKS = [
  { href: "/pricing", icon: SidebarPricingIcon, label: "Pricing" },
  { href: "/usage", icon: SidebarUsageIcon, label: "Usage" },
  { href: "mailto:hi@trycheatcode.com", icon: LifeBuoy, label: "Support" },
] as const;
const SIDEBAR_THEME_OPTIONS = [
  { icon: SidebarSystemThemeIcon, label: "System theme", value: "system" },
  { icon: SidebarLightThemeIcon, label: "Light theme", value: "light" },
  { icon: SidebarDarkThemeIcon, label: "Dark theme", value: "dark" },
] as const;

export function SidebarSettingsNavigation({
  onNavigate,
  onToggle,
  open,
  pathname,
}: {
  onNavigate: () => void;
  onToggle: () => void;
  open: boolean;
  pathname: string;
}) {
  return (
    <nav aria-label="Settings" className="relative z-10 mt-auto flex shrink-0 flex-col pt-1 pb-1">
      <div className="flex flex-col">
        <SidebarSettingsToggle onToggle={onToggle} open={open} />
        <SidebarSettingsDisclosure onNavigate={onNavigate} open={open} pathname={pathname} />
      </div>
    </nav>
  );
}

function SidebarSettingsToggle({ onToggle, open }: { onToggle: () => void; open: boolean }) {
  return (
    <button
      aria-controls="sidebar-settings-region"
      aria-expanded={open}
      aria-label="Settings"
      className="flex min-h-8 w-full items-center gap-2 px-[13px] py-1.5 text-left font-medium text-[14px] text-fg-secondary leading-5 transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.99] motion-reduce:transition-none"
      onClick={onToggle}
      type="button"
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        <MoreVertical aria-hidden="true" className="size-3.5" />
      </span>
      <span className="min-w-0 truncate">Settings</span>
    </button>
  );
}

function SidebarSettingsDisclosure({
  onNavigate,
  open,
  pathname,
}: {
  onNavigate: () => void;
  open: boolean;
  pathname: string;
}) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-in-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      id="sidebar-settings-region"
      inert={open ? undefined : true}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex flex-col gap-1.5 pt-1 pb-1">
          <div className="flex flex-col gap-0.5 pr-2 pl-7">
            {SETTINGS_MENU_LINKS.map((item) => (
              <SidebarMenuLink
                item={item}
                key={item.label}
                onNavigate={onNavigate}
                pathname={pathname}
              />
            ))}
          </div>
          <SidebarThemeTabs />
        </div>
      </div>
    </div>
  );
}

function SidebarMenuLink({
  item,
  onNavigate,
  pathname,
}: {
  item: (typeof SETTINGS_MENU_LINKS)[number];
  onNavigate: () => void;
  pathname: string;
}) {
  const external = isExternalHref(item.href);
  const isActive = !external && pathname === item.href;
  const content = <SidebarMenuLinkContent item={item} />;
  const className = cn(
    "flex h-8 w-full items-center gap-2 rounded-full px-[9px] py-1.5 text-left font-medium text-[14px] text-fg-secondary leading-5 transition-[background-color,color,transform] duration-150 ease-out hover:bg-secondary hover:text-foreground active:scale-[0.99] motion-reduce:transition-none",
    isActive && "bg-bg-elevated text-foreground",
  );
  if (external) {
    return (
      <a
        className={className}
        href={item.href}
        onClick={onNavigate}
        rel={item.href.startsWith("http") ? "noopener noreferrer" : undefined}
        target={item.href.startsWith("http") ? "_blank" : undefined}
      >
        {content}
      </a>
    );
  }
  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={className}
      href={item.href}
      onClick={onNavigate}
    >
      {content}
    </Link>
  );
}

function SidebarMenuLinkContent({ item }: { item: (typeof SETTINGS_MENU_LINKS)[number] }) {
  return (
    <>
      <item.icon className="h-3.5 w-3.5 shrink-0 [stroke-width:2.25]" />
      <span className="min-w-0 truncate">{item.label}</span>
    </>
  );
}

function SidebarThemeTabs() {
  const { activeTheme, setTheme } = useSidebarTheme();
  const activeIndex = SIDEBAR_THEME_OPTIONS.findIndex((option) => option.value === activeTheme);
  return (
    <div
      aria-label="Appearance"
      className="relative z-0 mx-1 flex h-8 items-center rounded-full border-2 border-border bg-background p-0.5"
      role="tablist"
    >
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-0 z-[-1] h-6 w-[72px] rounded-full bg-background shadow-sm transition-transform duration-200 ease-in-out motion-reduce:transition-none"
        style={{ transform: `translate(${activeIndex * 72 + 2}px, -50%)` }}
      />
      {SIDEBAR_THEME_OPTIONS.map((option) => (
        <button
          aria-label={option.label}
          aria-selected={activeTheme === option.value}
          className={cn(
            "flex h-6 flex-1 cursor-pointer items-center justify-center rounded-full transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.96] motion-reduce:transition-none",
            activeTheme === option.value ? "text-foreground" : "text-fg-secondary",
          )}
          key={option.value}
          onClick={() => setTheme(option.value)}
          role="tab"
          type="button"
        >
          <option.icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
