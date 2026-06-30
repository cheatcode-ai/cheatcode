import type { CSSProperties, ReactNode } from "react";
import type { PreviewDevice } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

/**
 * Functional device bezel slot (preview-surface §7.3 / §A2). `desktop` passes
 * through full-width; `tablet`/`phone` center the iframe inside a rounded device
 * bezel on a soft amber-tinted paper backdrop, mirroring bud's preview-mode
 * frames. Presentational only - no device logic, just the structural frame.
 */

const BACKDROP_STYLE: CSSProperties = {
  background:
    "radial-gradient(120% 120% at 50% -20%, rgba(251, 166, 42, 0.12) 0%, #f8f3ea 45%, #f1eadf 100%)",
};

export function DeviceFrame({ children, device }: { children: ReactNode; device: PreviewDevice }) {
  if (device === "desktop") {
    return <>{children}</>;
  }
  const isPhone = device === "phone";
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 items-stretch justify-center overflow-hidden p-4 sm:p-6"
      data-device-backdrop={device}
      style={BACKDROP_STYLE}
    >
      <div
        className={cn(
          "flex h-full w-full flex-col overflow-hidden border-[#1b1b1b] bg-white shadow-[0_24px_70px_rgba(27,27,27,0.22)]",
          isPhone
            ? "max-w-[390px] rounded-[44px] border-[12px]"
            : "max-w-[834px] rounded-[28px] border-[14px]",
        )}
        data-device-frame={device}
      >
        {children}
      </div>
    </div>
  );
}
