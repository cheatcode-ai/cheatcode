"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { LucideIcon } from "@/components/ui/icons";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Monitor,
  RefreshCw,
  Smartphone,
  Tablet,
} from "@/components/ui/icons";
import { buildPreviewIframeSrc, normalizePreviewPath, previewOrigin } from "@/lib/preview/url-bar";
import type { PreviewDevice } from "@/lib/store/app-store";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

const CONTROL_CLASS =
  "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-[#f1f1f1] hover:text-[#1b1b1b] disabled:cursor-not-allowed disabled:opacity-30";

const DEVICES: ReadonlyArray<{ value: PreviewDevice; label: string; Icon: LucideIcon }> = [
  { value: "desktop", label: "Desktop", Icon: Monitor },
  { value: "tablet", label: "Tablet", Icon: Tablet },
  { value: "phone", label: "Phone", Icon: Smartphone },
];

/**
 * Functional preview URL bar (preview-surface §7.3 / §A5). The iframe is
 * cross-origin, so this shows and edits the *entry URL* we command - never the
 * live SPA location after in-app navigation. Back/Refresh operate on our own
 * assignment history + the existing reload token.
 */
export function PreviewUrlBar({ previewUrl }: { previewUrl: string }) {
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const previewPath = useAppStore((state) => state.previewPath);
  const previewPathHistory = useAppStore((state) => state.previewPathHistory);
  const bumpPreviewReloadToken = useAppStore((state) => state.bumpPreviewReloadToken);
  const goBackPreviewPath = useAppStore((state) => state.goBackPreviewPath);
  const navigatePreviewPath = useAppStore((state) => state.navigatePreviewPath);
  const previewDevice = useAppStore((state) => state.previewDevice);
  const setPreviewDevice = useAppStore((state) => state.setPreviewDevice);
  const origin = previewOrigin(previewUrl);
  const ActiveDeviceIcon =
    DEVICES.find((device) => device.value === previewDevice)?.Icon ?? Monitor;

  const commitPath = (raw: string) => {
    const next = normalizePreviewPath(raw, previewUrl);
    if (next === null) {
      toast.error("Preview can only navigate within the sandbox origin");
      return;
    }
    navigatePreviewPath(next);
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 bg-white px-2.5">
      <button
        aria-label="Go back"
        className={CONTROL_CLASS}
        disabled={previewPathHistory.length === 0}
        onClick={goBackPreviewPath}
        type="button"
      >
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
      </button>
      <button aria-label="Go forward" className={CONTROL_CLASS} disabled type="button">
        <ChevronRight aria-hidden="true" className="h-4 w-4" />
      </button>
      <button
        aria-label="Refresh preview"
        className={CONTROL_CLASS}
        onClick={bumpPreviewReloadToken}
        type="button"
      >
        <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <div className="relative flex min-w-0 flex-1 items-center justify-center">
        <div className="flex h-[30px] w-full max-w-[560px] items-center gap-1 rounded-[8px] border border-[#d6d6d6] bg-[#f1f1f1] px-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
          <button
            aria-expanded={deviceMenuOpen}
            aria-label="Preview mode"
            className="flex h-[22px] shrink-0 items-center gap-1 rounded-[4px] px-1 text-[#5f5f5f] transition-colors hover:bg-white hover:text-[#1b1b1b]"
            onClick={() => setDeviceMenuOpen((open) => !open)}
            type="button"
          >
            <ActiveDeviceIcon aria-hidden="true" className="h-3.5 w-3.5" />
            <ChevronDown aria-hidden="true" className="h-3 w-3" />
          </button>
          <input
            aria-label={`Preview path on ${origin}`}
            className="min-w-0 flex-1 bg-transparent text-center font-mono text-[#5f5f5f] text-[12px] outline-none placeholder:text-[#8a8a8a]"
            defaultValue={previewPath}
            key={previewPath}
            onBlur={(event) => commitPath(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitPath(event.currentTarget.value);
                event.currentTarget.blur();
              }
            }}
            placeholder="/"
            spellCheck={false}
          />
          <div className="h-[22px] w-[34px] shrink-0" />
        </div>
        {deviceMenuOpen ? (
          <div className="absolute top-9 left-1/2 z-20 w-40 -translate-x-1/2 overflow-hidden rounded-[10px] border border-[#e3e3e3] bg-white p-1 shadow-[0_18px_60px_rgba(0,0,0,0.14)]">
            {DEVICES.map(({ value, label, Icon }) => (
              <button
                aria-pressed={previewDevice === value}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left font-medium text-[12px] transition-colors",
                  previewDevice === value
                    ? "bg-[#f1f1f1] text-[#1b1b1b]"
                    : "text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#1b1b1b]",
                )}
                key={value}
                onClick={() => {
                  setPreviewDevice(value);
                  setDeviceMenuOpen(false);
                }}
                type="button"
              >
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <a
        aria-label="Open preview in a new tab"
        className={CONTROL_CLASS}
        href={buildPreviewIframeSrc(previewUrl, previewPath, 0)}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
