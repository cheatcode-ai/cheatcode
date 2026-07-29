import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

const WIDTH_CLASS = {
  narrow: "max-w-[740px]",
  wide: "max-w-5xl",
} as const;

interface SettingsPageShellProps {
  children: ReactNode;
  width: keyof typeof WIDTH_CLASS;
}

export function SettingsPageShell({ children, width }: SettingsPageShellProps) {
  return (
    <section
      className={cn(
        "chat-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto bg-background px-2.5 pt-6 pb-16 text-foreground md:pt-10",
        width === "narrow" && "sm:px-6 lg:px-10",
      )}
    >
      <div className={cn("mx-auto w-full", WIDTH_CLASS[width])}>{children}</div>
    </section>
  );
}
