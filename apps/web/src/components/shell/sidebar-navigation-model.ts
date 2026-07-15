import type { NavItem } from "@/lib/navigation/nav-model";
import { WORKSPACE_NAV } from "@/lib/navigation/nav-model";

export const PRIMARY_NAV = navItems("primary");
export const WORKSPACE_SECTION_NAV = navItems("workspace");
export const FOOTER_NAV = navItems("footer");

function navItems(section: NavItem["section"]): NavItem[] {
  return WORKSPACE_NAV.filter((item) => item.section === section);
}

export function isExternalHref(href: string): boolean {
  return href.startsWith("http") || href.startsWith("mailto:");
}

/** Returns the active thread only for the `/chats/[chatId]` workspace route. */
export function activeChatIdFromPathname(pathname: string): string | null {
  const segments = pathname.split("/");
  if (segments[1] !== "chats") {
    return null;
  }
  const id = segments[2];
  return id ? decodeURIComponent(id) : null;
}
