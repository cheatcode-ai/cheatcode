import type { ReactNode } from "react";

/**
 * Functional bezel slot (preview-surface §7.3). `browser` passes through; `phone`
 * constrains the iframe to a phone-ish centered column. This is the structural
 * slot for the later bezel artwork — no visual design this round.
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
      className="mx-auto flex h-full w-full min-w-0 max-w-[420px] flex-col"
      data-device-frame="phone"
    >
      {children}
    </div>
  );
}
