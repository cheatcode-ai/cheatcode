import type { ReactNode } from "react";

/**
 * Functional bezel slot (preview-surface §7.3). `browser` passes through; `phone`
 * constrains the iframe to a phone-ish centered column. This is the structural
 * slot for the later bezel artwork - no visual design this round.
 */
export function DeviceFrame({
  children,
  frame,
}: {
  children: ReactNode;
  frame: "browser" | "phone";
}) {
  if (frame === "browser") {
    return <>{children}</>;
  }
  return (
    <div
      className="mx-auto flex h-full w-full min-w-0 max-w-[360px] flex-col overflow-hidden rounded-[36px] border-[#1b1b1b] border-[10px] bg-white shadow-[0_18px_60px_rgba(0,0,0,0.2)]"
      data-device-frame="phone"
    >
      {children}
    </div>
  );
}
