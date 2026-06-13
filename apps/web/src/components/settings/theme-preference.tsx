"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/ui/cn";

const THEME_OPTIONS = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
] as const;

export function ThemePreference() {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // next-themes resolves the active theme only on the client; gate selection
  // state on mount so server/first paint markup matches.
  useEffect(() => {
    setMounted(true);
  }, []);

  const active = mounted ? (theme ?? "system") : "system";

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-mono text-[10px] text-zinc-600 uppercase tracking-[0.2em]">
        Theme
      </legend>
      <div className="grid grid-cols-3 gap-2">
        {THEME_OPTIONS.map((option) => (
          <label
            className={cn(
              "flex cursor-pointer items-center justify-center rounded-xl border px-4 py-2 text-sm transition-colors",
              active === option.value
                ? "border-purple-500/40 bg-purple-500/10 text-white"
                : "border-zinc-800 bg-[#0b0b0b] text-zinc-400 hover:border-zinc-700",
            )}
            key={option.value}
          >
            <input
              checked={active === option.value}
              className="sr-only"
              disabled={!mounted}
              name="theme-preference"
              onChange={() => setTheme(option.value)}
              type="radio"
              value={option.value}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
