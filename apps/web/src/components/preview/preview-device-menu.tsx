"use client";

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "@/components/ui/icons";
import { Monitor, Smartphone, Tablet } from "@/components/ui/icons";
import type { PreviewDevice } from "@/lib/store/app-store";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

const DEVICES: ReadonlyArray<{ value: PreviewDevice; label: string; Icon: LucideIcon }> = [
  { value: "desktop", label: "Desktop", Icon: Monitor },
  { value: "tablet", label: "Tablet", Icon: Tablet },
  { value: "phone", label: "Phone", Icon: Smartphone },
];

export function PreviewDeviceMenu({ isPreviewAvailable }: { isPreviewAvailable: boolean }) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const disclosure = useDeviceMenuDisclosure(menuRef);
  const previewDevice = useAppStore((state) => state.previewDevice);
  const setPreviewDevice = useAppStore((state) => state.setPreviewDevice);
  const ActiveDeviceIcon =
    DEVICES.find((device) => device.value === previewDevice)?.Icon ?? Monitor;
  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        aria-expanded={disclosure.isOpen}
        aria-label="Preview mode"
        className="flex size-6 shrink-0 items-center justify-center rounded p-1 text-fg-secondary outline-none transition-colors duration-150 hover:bg-background/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        disabled={!isPreviewAvailable}
        onClick={disclosure.toggle}
        type="button"
      >
        <ActiveDeviceIcon aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {disclosure.isOpen && isPreviewAvailable ? (
        <DeviceMenuItems
          close={disclosure.close}
          previewDevice={previewDevice}
          setPreviewDevice={setPreviewDevice}
        />
      ) : null}
    </div>
  );
}

interface DeviceMenuItemsProps {
  close: () => void;
  previewDevice: PreviewDevice;
  setPreviewDevice: (device: PreviewDevice) => void;
}

function DeviceMenuItems({ close, previewDevice, setPreviewDevice }: DeviceMenuItemsProps) {
  return (
    <div
      className="absolute top-7 left-0 z-50 min-w-[140px] rounded-[14px] border border-border bg-background p-1 text-foreground shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]"
      role="menu"
    >
      {DEVICES.map(({ value, label, Icon }) => (
        <button
          className={cn(
            "flex h-[30px] w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left font-medium text-[12px] transition-colors duration-150",
            previewDevice === value
              ? "bg-secondary text-foreground"
              : "text-fg-secondary hover:bg-secondary hover:text-foreground",
          )}
          key={value}
          onClick={() => {
            setPreviewDevice(value);
            close();
          }}
          role="menuitem"
          type="button"
        >
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

function useDeviceMenuDisclosure(menuRef: RefObject<HTMLDivElement | null>) {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, menuRef]);
  return {
    close: () => setIsOpen(false),
    isOpen,
    toggle: () => setIsOpen((open) => !open),
  };
}
