"use client";

import type { ProjectSummary } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { QRCodeSVG } from "qrcode.react";
import { Activity, useEffect, useRef, useState } from "react";
import { BudTooltip } from "@/components/ui/bud-tooltip";
import {
  Download,
  ExternalLink,
  Inbox,
  type LucideIcon,
  Monitor,
  MoreHorizontal,
  Rocket,
} from "@/components/ui/icons";
import { buildPreviewIframeSrc } from "@/lib/preview/url-bar";
import { type PreviewLivePhase, useEnsurePreviewLive } from "@/lib/preview/use-ensure-preview-live";
import type { PreviewDevice, PreviewTab } from "@/lib/store/app-store";
import { useAppStore } from "@/lib/store/app-store";
import { emitFirstPreviewOpened } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";
import { BootingComputer } from "./booting-computer";
import { ConsoleStrip } from "./console-strip";
import { DeviceFrame } from "./device-frame";
import { PreviewUrlBar } from "./preview-url-bar";
import { SandboxIdeTab } from "./sandbox-ide-tab";

const TABS: ReadonlyArray<{ label: string; value: PreviewTab }> = [
  { label: "Files", value: "files" },
  { label: "Browser", value: "app" },
];

const APP_PREVIEW_IFRAME_ALLOW =
  "accelerometer; autoplay; camera; clipboard-read; clipboard-write; cross-origin-isolated; display-capture; encrypted-media; fullscreen; geolocation; gyroscope; microphone; midi; payment; publickey-credentials-get; screen-wake-lock; serial; usb; web-share; xr-spatial-tracking";

const APP_PREVIEW_IFRAME_SANDBOX =
  "allow-downloads allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation";

export function PreviewSidePanel({
  deliverableCount,
  project,
  threadId,
}: {
  deliverableCount: number;
  project: ProjectSummary | null;
  threadId: string;
}) {
  const { getToken } = useAuth();
  const activePreviewTab = useAppStore((state) => normalizeComputerTab(state.activePreviewTab));
  const expoUrl = useAppStore((state) => state.expoUrl);
  const previewDevice = useAppStore((state) => state.previewDevice);
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const previewReloadToken = useAppStore((state) => state.previewReloadToken);
  const previewUrl = useAppStore((state) => state.previewUrl);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const setActivePreviewTab = useAppStore((state) => state.setActivePreviewTab);
  const setPreviewPanelOpen = useAppStore((state) => state.setPreviewPanelOpen);
  // Mobile projects always render the preview in a phone frame regardless of the user's
  // desktop/tablet/phone toggle (which is for web apps) — the app IS a phone app.
  const isMobile = project?.mode === "app-builder-mobile";
  // Revive a sleeping app preview when the panel opens (Daytona idle-stops sandboxes and preview
  // traffic doesn't reset the timer). Only when there's a preview URL to revive — never docs/data.
  const previewPhase = useEnsurePreviewLive(
    threadId,
    getToken,
    previewPanelOpen && previewUrl !== null,
  );

  useEffect(() => {
    if (!previewUrl || !previewPanelOpen) {
      return;
    }
    void emitFirstPreviewOpened(getToken).catch(() => undefined);
  }, [getToken, previewPanelOpen, previewUrl]);

  // Per-user "computer" model: every user always has a computer sandbox, so the panel is always
  // available inside a chat. On a project-less new chat, opening it shows the computer root
  // (all projects) — matching bud's home computer view.
  return (
    <>
      <BudTooltip
        className={cn(
          "fixed top-3.5 right-3.5 z-40 hidden transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none md:flex",
          previewPanelOpen
            ? "pointer-events-none translate-y-0 scale-[0.98] opacity-0"
            : "translate-y-0 scale-100 opacity-100",
        )}
        label="Open computer"
        side="bottom"
      >
        <button
          aria-hidden={previewPanelOpen}
          aria-label="Open computer"
          className="flex h-7 items-center gap-1.5 rounded-full bg-[#1b1b1b] py-1 pr-3 pl-2.5 font-medium text-[14px] text-white transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-black active:scale-[0.97] motion-reduce:transition-none"
          onClick={() => setPreviewPanelOpen(true)}
          tabIndex={previewPanelOpen ? -1 : undefined}
          type="button"
        >
          <Monitor aria-hidden="true" className="h-4 w-4" />
          <span>Computer</span>
        </button>
      </BudTooltip>
      <aside
        aria-hidden={!previewPanelOpen}
        className={cn(
          "cc-agent-computer-pane hidden min-h-0 min-w-0 overflow-hidden bg-white transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transform-none motion-reduce:transition-none md:flex",
          previewPanelOpen
            ? "translate-x-0 opacity-100 blur-0"
            : "pointer-events-none translate-x-3 opacity-0 blur-[1px]",
        )}
        inert={previewPanelOpen ? undefined : true}
      >
        <div className="flex h-full max-h-full w-full min-w-0 flex-col gap-2 overflow-hidden bg-white">
          <PanelTabs
            activePreviewTab={activePreviewTab}
            deliverableCount={deliverableCount}
            projectName={project?.name ?? null}
            setActivePreviewTab={setActivePreviewTab}
            setPreviewPanelOpen={setPreviewPanelOpen}
          />
          {/* bud parity: ONE bordered card (border-2, rounded-24) wraps only the content;
              the console is a plain bar directly below it, never enclosed by the card. */}
          <div className="flex min-h-0 w-full flex-1 flex-col gap-0.5 overflow-hidden">
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-[24px] border-2 border-[#f1f1f1] bg-white p-0.5">
              <PanelBody
                activePreviewTab={activePreviewTab}
                device={previewDevice}
                expoUrl={expoUrl}
                hasProject={project !== null}
                isMobile={isMobile}
                previewPhase={previewPhase}
                previewReloadToken={previewReloadToken}
                previewUrl={previewUrl}
                sandboxStatus={sandboxStatus}
                threadId={threadId}
              />
            </div>
            {activePreviewTab === "files" ? (
              <ConsoleStrip sandboxAvailable={project !== null} threadId={threadId} />
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}

function PanelTabs({
  activePreviewTab,
  deliverableCount,
  projectName,
  setActivePreviewTab,
  setPreviewPanelOpen,
}: {
  activePreviewTab: PreviewTab;
  deliverableCount: number;
  projectName: string | null;
  setActivePreviewTab: (tab: PreviewTab) => void;
  setPreviewPanelOpen: (open: boolean) => void;
}) {
  const moreMenuRef = useRef<HTMLSpanElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!moreOpen) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (moreMenuRef.current?.contains(target)) {
        return;
      }
      setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);

  return (
    <div className="hidden h-12 w-full shrink-0 items-center justify-between overflow-visible px-[3px] md:flex">
      <div className="inline-flex items-center gap-0.5 rounded-full bg-[#f7f7f7] p-[3px] shadow-[0_0_1px_rgba(0,0,0,0.08)]">
        {TABS.map((tab) => (
          <BudTooltip key={tab.value} label={tab.label} side="bottom">
            <button
              aria-selected={activePreviewTab === tab.value}
              className={cn(
                "flex h-7 items-center justify-center whitespace-nowrap rounded-full px-3 font-medium text-[14px] transition-colors",
                activePreviewTab === tab.value
                  ? "bg-white text-[#1b1b1b] shadow-[0_1px_5px_rgba(0,0,0,0.08)]"
                  : "text-[#707070] hover:text-[#1b1b1b]",
              )}
              onClick={() => setActivePreviewTab(tab.value)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          </BudTooltip>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1 pr-1">
        <BudTooltip className="relative" disabled={moreOpen} label="More actions" side="bottom">
          <button
            aria-expanded={moreOpen}
            aria-label="More actions"
            className="flex h-7 w-7 items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
            onClick={() => {
              setMoreOpen((open) => !open);
            }}
            type="button"
          >
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
          </button>
          {moreOpen ? (
            <ComputerActionsMenu menuRef={moreMenuRef} projectName={projectName} />
          ) : null}
        </BudTooltip>
        <BudTooltip label="Close computer" side="bottom">
          <button
            aria-label="Close computer"
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#1b1b1b] py-1 pr-3 pl-2.5 font-medium text-[14px] text-white transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-black active:scale-[0.97] motion-reduce:transition-none"
            onClick={() => setPreviewPanelOpen(false)}
            type="button"
          >
            <Monitor aria-hidden="true" className="h-4 w-4" />
            <span>Computer</span>
          </button>
        </BudTooltip>
        {deliverableCount > 0 ? (
          <BudTooltip label="View deliverables" side="bottom">
            <button
              aria-expanded={false}
              aria-label="View deliverables"
              className="flex h-7 cursor-pointer items-center gap-1 rounded-full px-1.5 text-[#1b1b1b] outline-none transition-colors hover:bg-[#f7f7f7] focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={scrollToDeliverables}
              type="button"
            >
              <Inbox aria-hidden="true" className="h-4 w-4" />
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#1b1b1b] px-1 font-semibold text-[11px] text-white leading-none">
                {deliverableCount}
              </span>
            </button>
          </BudTooltip>
        ) : null}
      </div>
    </div>
  );
}

function scrollToDeliverables(): void {
  const blocks = document.querySelectorAll("[data-chat-deliverables]");
  const target = blocks.item(blocks.length - 1);
  target?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "center",
  });
}

function ComputerActionsMenu({
  menuRef,
  projectName,
}: {
  menuRef: React.RefObject<HTMLSpanElement | null>;
  projectName: string | null;
}) {
  const projectLabel = projectName ?? "project";

  return (
    <span
      className="absolute top-[32px] right-0 z-50 flex w-[244px] flex-col overflow-hidden rounded-[10px] border border-[#e6e6e6] bg-white p-1.5 text-[#1b1b1b] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]"
      ref={menuRef}
      role="menu"
    >
      <ComputerMenuButton disabled icon={Rocket} label={`Deploy ${projectLabel}`} />
      <ComputerMenuButton disabled icon={ExternalLink} label={`Sync ${projectLabel} to GitHub`} />
      <ComputerMenuButton disabled icon={Download} label={`Download ${projectLabel}`} />
    </span>
  );
}

function ComputerMenuButton({
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      aria-disabled={disabled}
      className={cn(
        "flex h-[31.5px] w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left font-medium text-[12px] transition-colors",
        disabled
          ? "cursor-not-allowed text-[#a0a0a0]"
          : "cursor-pointer text-[#1b1b1b] hover:bg-[#f1f1f1]",
      )}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[#8a8a8a]" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function PanelBody({
  activePreviewTab,
  device,
  expoUrl,
  hasProject,
  isMobile,
  previewPhase,
  previewReloadToken,
  previewUrl,
  sandboxStatus,
  threadId,
}: {
  activePreviewTab: PreviewTab;
  device: PreviewDevice;
  expoUrl: string | null;
  hasProject: boolean;
  isMobile: boolean;
  previewPhase: PreviewLivePhase;
  previewReloadToken: number;
  previewUrl: string | null;
  sandboxStatus: string;
  threadId: string;
}) {
  return (
    <div className="h-full min-h-0">
      <Activity mode={activePreviewTab === "app" ? "visible" : "hidden"}>
        <AppTab
          device={device}
          expoUrl={expoUrl}
          hasProject={hasProject}
          isMobile={isMobile}
          previewPhase={previewPhase}
          previewReloadToken={previewReloadToken}
          previewUrl={previewUrl}
          sandboxStatus={sandboxStatus}
        />
      </Activity>
      <Activity mode={activePreviewTab === "files" ? "visible" : "hidden"}>
        <SandboxIdeTab
          active={activePreviewTab === "files"}
          previewReloadToken={previewReloadToken}
          previewUrl={previewUrl}
          sandboxStatus={sandboxStatus}
          threadId={threadId}
        />
      </Activity>
    </div>
  );
}

function AppTab({
  device,
  expoUrl,
  hasProject,
  isMobile,
  previewPhase,
  previewReloadToken,
  previewUrl,
  sandboxStatus,
}: {
  device: PreviewDevice;
  expoUrl: string | null;
  hasProject: boolean;
  isMobile: boolean;
  previewPhase: PreviewLivePhase;
  previewReloadToken: number;
  previewUrl: string | null;
  sandboxStatus: string;
}) {
  const previewPath = useAppStore((state) => state.previewPath);
  // Mobile projects are always shown in the phone bezel; web apps honour the user toggle.
  const frameDevice: PreviewDevice = isMobile ? "phone" : device;
  // The sandbox is being (re)started + the dev server relaunched — show a boot state in the frame
  // instead of a dead iframe (a paused mid-view poll re-enters this too).
  if (previewPhase === "booting") {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white p-0.5">
        <PreviewUrlBar previewUrl={previewUrl} />
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-[20.5px]">
          <DeviceFrame device={frameDevice}>
            <BootingComputer label="Starting preview…" />
          </DeviceFrame>
          {expoUrl ? <ExpoDeviceTestPanel expoUrl={expoUrl} /> : null}
        </div>
      </div>
    );
  }
  if (previewUrl) {
    const iframeUrl = buildPreviewIframeSrc(previewUrl, previewPath, previewReloadToken);
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white p-0.5">
        <PreviewUrlBar previewUrl={previewUrl} />
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-[20.5px]">
          <DeviceFrame device={frameDevice}>
            <iframe
              className="min-h-0 min-w-0 flex-1 border-0 bg-white"
              key={iframeUrl}
              allow={APP_PREVIEW_IFRAME_ALLOW}
              allowFullScreen
              referrerPolicy="no-referrer"
              sandbox={APP_PREVIEW_IFRAME_SANDBOX}
              src={iframeUrl}
              title="Browser preview"
            />
          </DeviceFrame>
          {expoUrl ? <ExpoDeviceTestPanel expoUrl={expoUrl} /> : null}
        </div>
      </div>
    );
  }

  if (!hasProject && (sandboxStatus === "cold" || sandboxStatus === "starting")) {
    return <BootingComputer />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white p-0.5">
      <PreviewUrlBar previewUrl={null} />
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-[20.5px]">
        <DeviceFrame device={frameDevice}>
          <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-white font-medium text-[#8a8a8a] text-[13px]">
            No preview available
          </div>
        </DeviceFrame>
        {expoUrl ? <ExpoDeviceTestPanel expoUrl={expoUrl} /> : null}
      </div>
    </div>
  );
}

function normalizeComputerTab(tab: PreviewTab): PreviewTab {
  return tab === "files" ? "files" : "app";
}

function ExpoDeviceTestPanel({ expoUrl }: { expoUrl: string }) {
  return (
    <aside
      aria-label="Test on your device"
      className="chat-scrollbar flex w-[248px] shrink-0 flex-col gap-4 overflow-y-auto border-[#f1f1f1] border-l bg-white p-4"
    >
      <div className="font-semibold text-[#1b1b1b] text-[15px]">Test on your device</div>
      <div className="flex items-center justify-center rounded-[16px] border border-[#f1f1f1] bg-white p-3">
        <QRCodeSVG level="M" size={168} title="Expo Go QR code" value={expoUrl} />
      </div>
      <ol className="space-y-3">
        <li className="flex gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f7f7f7] text-[#707070] text-[11px]">
            1
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] text-thread-text-primary">
              Install Expo Go
            </div>
            <div className="mt-0.5 text-[11px] text-thread-text-secondary leading-relaxed">
              Free on the{" "}
              <a
                className="underline hover:text-thread-text-primary"
                href="https://apps.apple.com/app/expo-go/id982107779"
                rel="noreferrer"
                target="_blank"
              >
                App Store
              </a>{" "}
              and{" "}
              <a
                className="underline hover:text-thread-text-primary"
                href="https://play.google.com/store/apps/details?id=host.exp.exponent"
                rel="noreferrer"
                target="_blank"
              >
                Google Play
              </a>
              .
            </div>
          </div>
        </li>
        <li className="flex gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f7f7f7] text-[#707070] text-[11px]">
            2
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] text-thread-text-primary">
              Scan with your camera
            </div>
            <div className="mt-0.5 text-[11px] text-thread-text-secondary leading-relaxed">
              Use your camera or the Expo Go app. The build opens on your phone and live-reloads as
              the agent works.
            </div>
          </div>
        </li>
      </ol>
      <div className="min-w-0 rounded-[12px] border border-[#f1f1f1] bg-[#f7f7f7] p-2">
        <div className="break-all font-mono text-[10px] text-thread-text-secondary">{expoUrl}</div>
      </div>
      <p className="text-[10px] text-thread-text-tertiary leading-relaxed">
        The in-browser preview approximates native rendering. For accurate results, test on a real
        device.
      </p>
    </aside>
  );
}
