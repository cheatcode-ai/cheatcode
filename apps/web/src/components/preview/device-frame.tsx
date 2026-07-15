import type { CSSProperties, ReactNode } from "react";
import type { PreviewDevice } from "@/lib/store/app-store";

/**
 * Functional device bezel slot. `desktop` passes
 * through full-width; `tablet`/`phone` center the iframe inside a rounded device
 * bezel on a soft amber-tinted paper backdrop, mirroring Cheatcode's preview-mode
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
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-4 [container-type:size] sm:p-6"
      data-device-backdrop={device}
      style={BACKDROP_STYLE}
    >
      {isPhone ? (
        <div
          className="relative flex flex-col overflow-hidden rounded-[44px] border-[12px] border-foreground bg-background shadow-[0_24px_70px_rgba(27,27,27,0.22)]"
          data-device-frame={device}
          // Lock the iPhone 390x844 silhouette and scale to fit BOTH panel axes with pure
          // CSS (container-query units): width fills the panel height, clamped to its width.
          style={{ aspectRatio: "390 / 844", width: "min(100cqw, calc(100cqh * 390 / 844))" }}
        >
          {children}
        </div>
      ) : (
        <div
          className="flex h-full w-full max-w-[834px] flex-col overflow-hidden rounded-[28px] border-[14px] border-foreground bg-background shadow-[0_24px_70px_rgba(27,27,27,0.22)]"
          data-device-frame={device}
        >
          {children}
        </div>
      )}
    </div>
  );
}
