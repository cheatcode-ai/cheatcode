"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { LucideIcon } from "@/components/ui/icons";
import {
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
export function PreviewUrlBar({ previewUrl }: { previewUrl: string | null }) {
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const deviceMenuRef = useRef<HTMLDivElement | null>(null);
  const previewPath = useAppStore((state) => state.previewPath);
  const previewPathHistory = useAppStore((state) => state.previewPathHistory);
  const bumpPreviewReloadToken = useAppStore((state) => state.bumpPreviewReloadToken);
  const goBackPreviewPath = useAppStore((state) => state.goBackPreviewPath);
  const navigatePreviewPath = useAppStore((state) => state.navigatePreviewPath);
  const previewDevice = useAppStore((state) => state.previewDevice);
  const setPreviewDevice = useAppStore((state) => state.setPreviewDevice);
  const origin = previewUrl ? previewOrigin(previewUrl) : "computer";
  const ActiveDeviceIcon =
    DEVICES.find((device) => device.value === previewDevice)?.Icon ?? Monitor;

  useEffect(() => {
    if (!deviceMenuOpen) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (deviceMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setDeviceMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDeviceMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [deviceMenuOpen]);

  const commitPath = (raw: string) => {
    if (!previewUrl) {
      return;
    }
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
        disabled={!previewUrl || previewPathHistory.length === 0}
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
        disabled={!previewUrl}
        onClick={bumpPreviewReloadToken}
        type="button"
      >
        <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <div className="relative flex min-w-0 flex-1 items-center justify-center">
        <div className="flex h-[30px] w-full max-w-[560px] items-center gap-1 rounded-[8px] border border-[#d6d6d6] bg-[#f1f1f1] px-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
          <div className="relative shrink-0" ref={deviceMenuRef}>
            <button
              aria-expanded={deviceMenuOpen}
              aria-label="Preview mode"
              className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] p-0.5 text-[#5f5f5f] transition-colors duration-150 hover:bg-white/70 hover:text-[#1b1b1b] disabled:cursor-not-allowed disabled:opacity-30"
              disabled={!previewUrl}
              onClick={() => setDeviceMenuOpen((open) => !open)}
              type="button"
            >
              <ActiveDeviceIcon aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
            {deviceMenuOpen && previewUrl ? (
              <div
                className="absolute top-[22px] left-0 z-50 min-w-[140px] rounded-[14px] border border-[#e6e6e6] bg-white p-1 text-[#1b1b1b] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]"
                role="menu"
              >
                {DEVICES.map(({ value, label, Icon }) => (
                  <button
                    className={cn(
                      "flex h-[30px] w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left font-medium text-[12px] transition-colors duration-150",
                      previewDevice === value
                        ? "bg-[#f1f1f1] text-[#1b1b1b]"
                        : "text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#1b1b1b]",
                    )}
                    key={value}
                    onClick={() => {
                      setPreviewDevice(value);
                      setDeviceMenuOpen(false);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {previewUrl ? (
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
          ) : (
            <div className="min-w-0 flex-1 truncate text-center font-medium text-[#8a8a8a] text-[13px]">
              All apps and browser use activity will load here
            </div>
          )}
          <div className="h-[22px] w-[34px] shrink-0" />
        </div>
      </div>
      {previewUrl ? (
        <a
          aria-label="Open preview in a new tab"
          className={CONTROL_CLASS}
          href={buildPreviewIframeSrc(previewUrl, previewPath, 0)}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
        </a>
      ) : (
        <button
          aria-label="Open preview in a new tab"
          className={CONTROL_CLASS}
          disabled
          type="button"
        >
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
