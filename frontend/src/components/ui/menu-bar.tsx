"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { LucideIcon } from "lucide-react"

interface MenuItem {
  icon: LucideIcon | React.FC
  label: string
  href: string
  gradient: string
  iconColor: string
}

interface MenuBarProps extends React.HTMLAttributes<HTMLDivElement> {
  items: MenuItem[]
  activeItem?: string
  onItemClick?: (label: string) => void
}

export const MenuBar = React.forwardRef<HTMLDivElement, MenuBarProps>(
  ({ className, items, activeItem, onItemClick, ...props }, ref) => {
    return (
      <nav
        ref={ref}
        className={cn(
          "flex items-center p-1 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800",
          className,
        )}
        {...props}
      >
        <ul className="flex items-center gap-1">
          {items.map((item) => {
            const isActive = item.label === activeItem
            const Icon = item.icon

            return (
              <li key={item.label} className="relative">
                <button
                  onClick={() => onItemClick?.(item.label)}
                  className={cn(
                    "relative px-4 py-2 rounded-full text-sm font-medium transition-colors duration-200 ease-in-out flex items-center gap-2",
                    isActive 
                      ? "text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800 shadow-sm" 
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50"
                  )}
                >
                  <Icon className={cn("w-4 h-4", isActive ? "opacity-100" : "opacity-70")} />
                  <span>{item.label === 'Bring Your Own Key (BYOK)' ? 'BYOK' : item.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    )
  },
)

MenuBar.displayName = "MenuBar"