"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface Tab {
  title: string;
  icon: LucideIcon;
  iconColor?: string;
  type?: never;
}

interface Separator {
  type: "separator";
  title?: never;
  icon?: never;
}

type TabItem = Tab | Separator;

interface ExpandableTabsProps {
  tabs: TabItem[];
  className?: string;
  activeColor?: string;
  onChange?: (index: number | null) => void;
}

const buttonVariants = {
  initial: {
    gap: 0,
    paddingLeft: "0",
    paddingRight: "0",
  },
  animate: (isSelected: boolean) => ({
    gap: isSelected ? "0.25rem" : 0,
    paddingLeft: "0",
    paddingRight: isSelected ? "0.5rem" : "0",
  }),
};

const transition = { type: "spring" as const, bounce: 0, duration: 0.4 };

export function ExpandableTabs({
  tabs,
  className,
  activeColor: _activeColor = "text-primary",
  onChange,
}: ExpandableTabsProps) {
  const [selected, setSelected] = React.useState<number | null>(0);



  React.useEffect(() => {
    // Ensure web app is selected by default on mount (only once)
    onChange?.(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Remove onChange dependency to prevent race condition

  const handleSelect = (index: number) => {
    setSelected(index);
    onChange?.(index);
  };

  const Separator = () => (
    <div className="mx-1 h-[24px] w-[1px] bg-zinc-800" aria-hidden="true" />
  );

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full p-1",
        className
      )}
    >
      {tabs.map((tab, index) => {
        if (tab.type === "separator") {
          return <Separator key={`separator-${index}`} />;
        }

        const tabItem = tab as Tab;
        const Icon = tabItem.icon;
        const isSelected = selected === index;

        return (
          <motion.button
            key={tabItem.title}
            variants={buttonVariants}
            initial={false}
            animate="animate"
            custom={isSelected}
            onClick={() => handleSelect(index)}
            transition={transition}
            className={cn(
              "relative flex items-center justify-center rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors duration-200 outline-none",
              isSelected
                ? "text-white"
                : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <Icon size={16} className={cn("mr-2 transition-colors", isSelected ? "text-white" : "text-zinc-500 group-hover:text-zinc-400")} />
            <span className="whitespace-nowrap">
              {tabItem.title}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}