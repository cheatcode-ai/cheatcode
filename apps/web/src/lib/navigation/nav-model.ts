import { SlidersHorizontal } from "@cheatcode/ui";
import type { ComponentType } from "react";
import {
  SidebarModelsIcon,
  SidebarNewChatIcon,
  SidebarPersonalizationIcon,
  SidebarProjectsIcon,
  SidebarSkillsIcon,
} from "@/components/shell/sidebar-nav-icons";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";

type NavItemId =
  | "cheatcode-101"
  | "models"
  | "new-task"
  | "personalization"
  | "projects"
  | "settings"
  | "skills";

type NavSection = "footer" | "primary" | "workspace";

type NavTarget = { href: string; kind: "route"; matchPrefix: string } | { kind: "action" };

export interface NavItem {
  description?: string;
  expandable?: boolean;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "false" | "true" }>;
  id: NavItemId;
  label: string;
  section: NavSection;
  target: NavTarget;
}

/** Canonical sidebar information architecture shared by the expanded and rail views. */
export const WORKSPACE_NAV: readonly NavItem[] = [
  {
    icon: SidebarNewChatIcon,
    id: "new-task",
    label: "New chat",
    section: "primary",
    target: { href: "/", kind: "route", matchPrefix: "/" },
  },
  {
    expandable: true,
    icon: SidebarProjectsIcon,
    id: "projects",
    label: "Projects",
    section: "primary",
    target: { kind: "action" },
  },
  {
    icon: SidebarSkillsIcon,
    id: "skills",
    label: "Skills",
    section: "workspace",
    target: { href: "/skills", kind: "route", matchPrefix: "/skills" },
  },
  {
    icon: SidebarPersonalizationIcon,
    id: "personalization",
    label: "Personalization",
    section: "workspace",
    target: {
      href: "/personalization",
      kind: "route",
      matchPrefix: "/personalization",
    },
  },
  {
    icon: SidebarModelsIcon,
    id: "models",
    label: "Models",
    section: "workspace",
    target: { href: "/models", kind: "route", matchPrefix: "/models" },
  },
  {
    description: "Learn what Cheatcode can do",
    icon: CheatcodeMark,
    id: "cheatcode-101",
    label: "Cheatcode 101",
    section: "footer",
    target: { href: "/101", kind: "route", matchPrefix: "/101" },
  },
  {
    icon: SlidersHorizontal,
    id: "settings",
    label: "Settings",
    section: "footer",
    target: { href: "/usage", kind: "route", matchPrefix: "/usage" },
  },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.target.kind !== "route") {
    return false;
  }
  if (item.target.matchPrefix === "/") {
    return pathname === "/";
  }
  return pathname === item.target.href || pathname.startsWith(`${item.target.matchPrefix}/`);
}
