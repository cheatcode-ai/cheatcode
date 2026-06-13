"use client";

import Link from "next/link";
import * as React from "react";
import type { LucideIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

interface MenuItem {
  gradient: string;
  href: string;
  icon: LucideIcon | React.FC;
  iconColor: string;
  label: string;
}

interface MenuBarProps extends React.HTMLAttributes<HTMLDivElement> {
  activeItem?: string;
  items: MenuItem[];
  onItemClick?: (label: string) => void;
}

export const MenuBar = React.forwardRef<HTMLDivElement, MenuBarProps>(
  ({ activeItem, className, items, onItemClick, ...props }, ref) => {
    return (
      <nav
        className={cn(
          "flex items-center rounded-full border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900",
          className,
        )}
        ref={ref}
        {...props}
      >
        <ul className="flex items-center gap-1">
          {items.map((item) => {
            const isActive = item.label === activeItem;
            const Icon = item.icon;

            return (
              <li className="relative" key={item.label}>
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative flex items-center gap-2 rounded-full px-4 py-2 font-medium text-sm transition-colors duration-200 ease-in-out",
                    isActive
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                      : "text-zinc-500 hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200",
                  )}
                  href={item.href}
                  onClick={() => onItemClick?.(item.label)}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "h-4 w-4",
                      item.iconColor,
                      isActive ? "opacity-100" : "opacity-70",
                    )}
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  },
);

MenuBar.displayName = "MenuBar";
