import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Shared Computer viewport frame. The inner frame deliberately overlaps the
 * outer frame so its top and side rails stay perfectly aligned in both themes.
 * The one-pixel console rail also keeps the collapsed and expanded layouts on
 * the same grid instead of making the editor jump when the console opens.
 */
export function ComputerSurfaceFrame({
  children,
  consoleStrip,
  offsetInnerFrame = false,
}: {
  children: ReactNode;
  consoleStrip: ReactElement | null;
  offsetInnerFrame?: boolean;
}) {
  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-3xl border-2 border-border">
      <div
        className={cn("relative flex h-full min-h-0 flex-1", offsetInnerFrame && "translate-x-1")}
      >
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <div className="-mx-0.5 -mt-0.5 min-h-0 flex-1 rounded-3xl border-2 border-border p-0.5">
            {children}
          </div>
          {consoleStrip ? (
            <>
              <div aria-hidden="true" className="h-px w-full shrink-0" />
              <div className="flex shrink-0 flex-col">{consoleStrip}</div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
