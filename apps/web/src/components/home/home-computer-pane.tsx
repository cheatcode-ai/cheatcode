"use client";

import { BudTooltip } from "@/components/ui/bud-tooltip";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { Monitor } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

const COMPUTER_PILL_CLASS =
  "inline-flex h-7 items-center gap-1.5 rounded-full bg-[#1b1b1b] py-1 pr-3 pl-2.5 font-medium text-[14px] text-white transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-black active:scale-[0.97] motion-reduce:transition-none";

/**
 * The home page's "Computer" pane. Renders as the `.cc-agent-computer-pane` flex
 * child of {@link WorkspaceRunLayout} (not `position: fixed`), mirroring the chat's
 * {@link PreviewSidePanel} structure. The home has no threadId/real sandbox, so
 * there is nothing to file-browse, preview, or run yet — showing the (non-working)
 * Files/Browser tabs and console strip here would be dishonest chrome, so the pane
 * shows only a plain placeholder plus the close pill. The real files/preview/console
 * live in the chat/project workspace once a build starts. Also renders the floating
 * "Open computer" pill shown while the pane is collapsed.
 */
export function HomeComputerPane({
  computerOpen,
  onClose,
  onOpen,
}: {
  computerOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  return (
    <>
      <OpenComputerPill computerOpen={computerOpen} onOpen={onOpen} />
      <aside
        aria-hidden={!computerOpen}
        aria-label="Computer"
        className={cn(
          "cc-agent-computer-pane hidden min-h-0 min-w-0 overflow-hidden bg-white transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transform-none motion-reduce:transition-none md:flex",
          computerOpen
            ? "translate-x-0 opacity-100 blur-0"
            : "pointer-events-none translate-x-3 opacity-0 blur-[1px]",
        )}
        inert={computerOpen ? undefined : true}
      >
        <div className="flex h-full max-h-full w-full min-w-0 flex-col gap-2 overflow-hidden bg-white">
          <div className="hidden h-12 w-full shrink-0 items-center justify-end px-[3px] md:flex">
            <BudTooltip label="Close computer" side="bottom">
              <button
                aria-label="Close computer"
                className={COMPUTER_PILL_CLASS}
                onClick={onClose}
                type="button"
              >
                <Monitor aria-hidden="true" className="h-4 w-4" />
                <span>Computer</span>
              </button>
            </BudTooltip>
          </div>
          <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center overflow-hidden rounded-[24px] border border-[#f1f1f1] bg-white px-8 shadow-[0_0_1px_rgba(0,0,0,0.08)]">
            <HomeComputerPlaceholder />
          </div>
        </div>
      </aside>
    </>
  );
}

function OpenComputerPill({ computerOpen, onOpen }: { computerOpen: boolean; onOpen: () => void }) {
  return (
    <BudTooltip
      className={cn(
        "fixed top-3.5 right-3.5 z-40 hidden transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none md:flex",
        computerOpen
          ? "pointer-events-none translate-y-0 scale-[0.98] opacity-0"
          : "translate-y-0 scale-100 opacity-100",
      )}
      label="Open computer"
      side="bottom"
    >
      <button
        aria-hidden={computerOpen}
        aria-label="Open computer"
        className={COMPUTER_PILL_CLASS}
        onClick={onOpen}
        tabIndex={computerOpen ? -1 : undefined}
        type="button"
      >
        <Monitor aria-hidden="true" className="h-4 w-4" />
        <span>Computer</span>
      </button>
    </BudTooltip>
  );
}

function HomeComputerPlaceholder() {
  return (
    <div className="max-w-sm text-center">
      <CheatcodeMark aria-hidden="true" className="mx-auto h-12 w-12 text-[#f8af2c]" />
      <p className="mt-5 font-semibold text-[#1b1b1b] text-[18px]">
        Your computer will appear here
      </p>
      <p className="mt-2 text-[#707070] text-[14px] leading-6">
        Describe what you want to build and your files, live preview, and console open in this
        panel.
      </p>
    </div>
  );
}
