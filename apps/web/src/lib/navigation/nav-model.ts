import type { ComponentType } from "react";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import {
  BookOpen,
  Link as LinkIcon,
  Monitor,
  Plus,
  SlidersHorizontal,
  TrendingUp,
  User,
  Zap,
} from "@/components/ui/icons";

export type NavItemId =
  | "automations"
  | "cheatcode-101"
  | "models"
  | "new-task"
  | "personalization"
  | "projects"
  | "settings"
  | "skills"
  | "tools"
  | "usage";

export type NavSection = "footer" | "primary" | "workspace";

export type NavTarget = { href: string; kind: "route"; matchPrefix: string };

export interface NavItem {
  description?: string;
  expandable?: boolean;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "false" | "true" }>;
  id: NavItemId;
  label: string;
  section: NavSection;
  status: "active" | "planned";
  target: NavTarget;
}

/**
 * Canonical sidebar IA. The future Bud sidebar consumes the whole registry; this
 * round the existing sidebar renders only `status: "active"` items as plain
 * links. `planned` entries are reserved for the automations / billing-credits /
 * user-foundation clusters to flip on.
 */
export const WORKSPACE_NAV: readonly NavItem[] = [
  {
    icon: Plus,
    id: "new-task",
    label: "New chat",
    section: "primary",
    status: "active",
    target: { href: "/", kind: "route", matchPrefix: "/" },
  },
  {
    expandable: true,
    icon: Monitor,
    id: "projects",
    label: "Projects",
    section: "primary",
    status: "active",
    target: { href: "/projects", kind: "route", matchPrefix: "/projects" },
  },
  {
    icon: CheatcodeMark,
    id: "skills",
    label: "Skills",
    section: "workspace",
    status: "active",
    target: { href: "/skills", kind: "route", matchPrefix: "/skills" },
  },
  {
    icon: LinkIcon,
    id: "tools",
    label: "Tools",
    section: "workspace",
    status: "active",
    target: { href: "/tools", kind: "route", matchPrefix: "/tools" },
  },
  {
    icon: Zap,
    id: "automations",
    label: "Automations",
    section: "workspace",
    status: "active",
    target: { href: "/automations", kind: "route", matchPrefix: "/automations" },
  },
  {
    icon: User,
    id: "personalization",
    label: "Personalization",
    section: "workspace",
    status: "active",
    target: {
      href: "/settings/personalization",
      kind: "route",
      matchPrefix: "/settings/personalization",
    },
  },
  {
    icon: SlidersHorizontal,
    id: "models",
    label: "Models",
    section: "workspace",
    status: "active",
    target: { href: "/settings/agents", kind: "route", matchPrefix: "/settings/agents" },
  },
  {
    description: "Learn what agents can do",
    icon: BookOpen,
    id: "cheatcode-101",
    label: "cheatcode 101",
    section: "footer",
    status: "active",
    target: { href: "/101", kind: "route", matchPrefix: "/101" },
  },
  {
    icon: TrendingUp,
    id: "usage",
    label: "Usage",
    section: "footer",
    status: "planned",
    target: { href: "/usage", kind: "route", matchPrefix: "/usage" },
  },
  {
    icon: SlidersHorizontal,
    id: "settings",
    label: "Settings",
    section: "footer",
    status: "active",
    target: { href: "/settings", kind: "route", matchPrefix: "/settings" },
  },
];

/** Active route nav items (excludes `planned` entries and `action` targets). */
export function activeRouteNavItems(section: NavSection): NavItem[] {
  return WORKSPACE_NAV.filter(
    (item) => item.section === section && item.status === "active" && item.target.kind === "route",
  );
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.target.kind !== "route") {
    return false;
  }
  if (item.target.matchPrefix === "/") {
    return pathname === "/";
  }
  return pathname === item.target.href || pathname.startsWith(`${item.target.matchPrefix}/`);
}
