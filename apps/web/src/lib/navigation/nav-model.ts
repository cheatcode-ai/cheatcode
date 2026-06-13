import {
  BookOpen,
  type LucideIcon,
  Monitor,
  Plus,
  SlidersHorizontal,
  Sparkles,
  SquareAsterisk,
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
  | "search"
  | "settings"
  | "skills"
  | "usage";

export type NavSection = "footer" | "primary" | "workspace";

export type NavTarget =
  | { action: "open-search"; kind: "action" }
  | { href: string; kind: "route"; matchPrefix: string };

export interface NavItem {
  description?: string;
  expandable?: boolean;
  icon: LucideIcon;
  id: NavItemId;
  label: string;
  section: NavSection;
  status: "active" | "planned";
  target: NavTarget;
}

/**
 * Canonical sidebar IA. The future Bud sidebar consumes the whole registry; this
 * round the existing sidebar renders only `status: "active"` workspace/footer
 * items as plain links and wires `open-search` to the command palette. `planned`
 * entries are reserved for the automations / billing-credits / user-foundation
 * clusters to flip on.
 */
export const WORKSPACE_NAV: readonly NavItem[] = [
  {
    icon: Plus,
    id: "new-task",
    label: "New task",
    section: "primary",
    status: "active",
    target: { href: "/", kind: "route", matchPrefix: "/" },
  },
  {
    icon: SquareAsterisk,
    id: "search",
    label: "Search",
    section: "primary",
    status: "active",
    target: { action: "open-search", kind: "action" },
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
    icon: Sparkles,
    id: "skills",
    label: "Skills",
    section: "workspace",
    status: "active",
    target: { href: "/skills", kind: "route", matchPrefix: "/skills" },
  },
  {
    icon: Zap,
    id: "automations",
    label: "Automations",
    section: "workspace",
    status: "planned",
    target: { href: "/automations", kind: "route", matchPrefix: "/automations" },
  },
  {
    icon: User,
    id: "personalization",
    label: "Personalization",
    section: "workspace",
    status: "planned",
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
