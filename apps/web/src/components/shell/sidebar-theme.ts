"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

export function useSidebarTheme() {
  const { setTheme, theme } = useTheme();
  const isHydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const activeTheme = isHydrated && (theme === "dark" || theme === "system") ? theme : "light";
  return { activeTheme, setTheme };
}
