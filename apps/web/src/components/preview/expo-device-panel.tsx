"use client";

import { QRCodeSVG } from "qrcode.react";
import type { ReactNode } from "react";
import { Smartphone } from "@/components/ui";

export function ExpoDevicePanel({ expoUrl }: { expoUrl: string }) {
  return (
    <aside
      aria-label="Test on your device"
      className="absolute top-3 right-3 z-10 flex max-h-[calc(100%-24px)] w-[232px] overflow-hidden rounded-[22px] border-2 border-border bg-bg-lifted/92 p-0.5 shadow-[0_12px_36px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-md"
    >
      <div className="chat-scrollbar flex h-full min-h-0 w-full flex-col gap-3.5 overflow-y-auto rounded-[18px] border border-border bg-bg-elevated/88 p-3.5">
        <ExpoDeviceHeader />
        <ExpoQrCode expoUrl={expoUrl} />
        <ExpoInstructions />
        <p className="text-[10px] text-thread-text-tertiary leading-relaxed">
          The in-browser preview approximates native rendering. For accurate results, test on a real
          device.
        </p>
      </div>
    </aside>
  );
}

function ExpoDeviceHeader() {
  return (
    <div className="flex items-center gap-2 font-semibold text-[14px] text-foreground">
      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-fg-secondary shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <Smartphone aria-hidden="true" className="h-3.5 w-3.5" />
      </span>
      Test on your device
    </div>
  );
}

function ExpoQrCode({ expoUrl }: { expoUrl: string }) {
  return (
    <div className="rounded-[18px] border-2 border-border bg-background p-0.5">
      <div className="flex items-center justify-center rounded-[14px] border border-border bg-background p-2.5">
        <QRCodeSVG level="M" size={164} title="Expo Go QR code" value={expoUrl} />
      </div>
    </div>
  );
}

function ExpoInstructions() {
  return (
    <ol className="space-y-3">
      <ExpoInstruction number="1" title="Install Expo Go">
        <ExpoStoreLinks />
      </ExpoInstruction>
      <ExpoInstruction number="2" title="Scan with your camera">
        Use your camera or the Expo Go app. The build opens on your phone and live-reloads as the
        agent works.
      </ExpoInstruction>
    </ol>
  );
}

function ExpoInstruction({
  children,
  number,
  title,
}: {
  children: ReactNode;
  number: string;
  title: string;
}) {
  return (
    <li className="flex gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] text-fg-secondary">
        {number}
      </span>
      <div className="min-w-0">
        <div className="font-semibold text-[13px] text-thread-text-primary">{title}</div>
        <div className="mt-0.5 text-[11px] text-thread-text-secondary leading-relaxed">
          {children}
        </div>
      </div>
    </li>
  );
}

function ExpoStoreLinks() {
  return (
    <>
      Free on the{" "}
      <a
        aria-label="App Store (opens in a new tab)"
        className="underline hover:text-thread-text-primary"
        href="https://apps.apple.com/app/expo-go/id982107779"
        rel="noreferrer"
        target="_blank"
      >
        App Store
      </a>{" "}
      and{" "}
      <a
        aria-label="Google Play (opens in a new tab)"
        className="underline hover:text-thread-text-primary"
        href="https://play.google.com/store/apps/details?id=host.exp.exponent"
        rel="noreferrer"
        target="_blank"
      >
        Google Play
      </a>
      .
    </>
  );
}
