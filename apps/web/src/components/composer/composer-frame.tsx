import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export const COMPOSER_TEXTAREA_CLASS =
  "block max-h-[200px] min-h-[80px] w-full resize-none overflow-y-auto border-none bg-transparent px-2 pb-0 font-medium text-foreground text-[14px] leading-6 outline-none placeholder:text-placeholder";

/** Shared visual frame for the home and in-thread composers. */
export function ComposerFrame({
  children,
  className,
  fillClassName,
  isWorking = false,
}: {
  children: ReactNode;
  className?: string | undefined;
  fillClassName?: string | undefined;
  isWorking?: boolean | undefined;
}) {
  return (
    <div
      className={cn(
        "cheatcode-composer-shell relative w-full overflow-visible rounded-[24px] p-px",
        isWorking && "cheatcode-composer-working",
        className,
      )}
    >
      <div
        className={cn(
          "cheatcode-composer-fill flex flex-col justify-between rounded-[21px] px-2 pb-2 transition-[box-shadow] duration-200 focus-within:shadow-[inset_0_0_40px_0_oklch(0.93_0.06_70_/_0.4)] dark:focus-within:shadow-[inset_0_0_40px_0_oklch(0.5_0.1_70_/_0.12)]",
          fillClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
