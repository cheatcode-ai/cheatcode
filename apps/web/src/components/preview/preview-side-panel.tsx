"use client";

import type { ProjectSummary } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { QRCodeSVG } from "qrcode.react";
import { Activity, useEffect } from "react";
import { PanelRightOpen, X } from "@/components/ui/icons";
import { buildPreviewIframeSrc } from "@/lib/preview/url-bar";
import type { PreviewTab } from "@/lib/store/app-store";
import { useAppStore } from "@/lib/store/app-store";
import { emitFirstPreviewOpened } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";
import { BrowserTakeoverTab } from "./browser-takeover-tab";
import { ConsoleStrip } from "./console-strip";
import { DeviceFrame } from "./device-frame";
import { PreviewUrlBar } from "./preview-url-bar";
import { SandboxEnvTab } from "./sandbox-env-tab";
import { SandboxFilesTab } from "./sandbox-files-tab";
import { SandboxTerminalTab } from "./sandbox-terminal-tab";

const TABS: ReadonlyArray<{ label: string; value: PreviewTab }> = [
  { label: "App", value: "app" },
  { label: "Files", value: "files" },
  { label: "Browser", value: "browser" },
  { label: "Terminal", value: "terminal" },
  { label: "Env", value: "env" },
];

export function PreviewSidePanel({
  project,
  threadId,
}: {
  project: ProjectSummary | null;
  threadId: string;
}) {
  const { getToken } = useAuth();
  const activePreviewTab = useAppStore((state) => state.activePreviewTab);
  const connectionState = useAppStore((state) => state.connectionState);
  const expoUrl = useAppStore((state) => state.expoUrl);
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const previewReloadToken = useAppStore((state) => state.previewReloadToken);
  const previewUrl = useAppStore((state) => state.previewUrl);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const setActivePreviewTab = useAppStore((state) => state.setActivePreviewTab);
  const setPreviewPanelOpen = useAppStore((state) => state.setPreviewPanelOpen);
  const hasPreviewSurface = previewUrl !== null || sandboxStatus !== "cold";
  // Mobile projects get the phone column; expoUrl is a defensive fallback for
  // legacy rows whose mode predates app-builder-mobile (preview-surface §A6).
  const deviceFrame: "browser" | "phone" =
    project?.mode === "app-builder-mobile" || expoUrl !== null ? "phone" : "browser";

  useEffect(() => {
    if (!previewUrl || !previewPanelOpen) {
      return;
    }
    void emitFirstPreviewOpened(getToken).catch(() => undefined);
  }, [getToken, previewPanelOpen, previewUrl]);

  if (!hasPreviewSurface) {
    return null;
  }

  if (!previewPanelOpen) {
    return (
      <button
        aria-label="Open preview"
        className="fixed top-1/2 right-6 z-40 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[#f1f1f1] bg-white text-[#707070] shadow-[0_18px_60px_rgba(0,0,0,0.12)] backdrop-blur-md transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
        onClick={() => setPreviewPanelOpen(true)}
        type="button"
      >
        <PanelRightOpen aria-hidden="true" className="h-5 w-5" />
      </button>
    );
  }

  return (
    <aside className="hidden h-screen min-w-[620px] flex-1 bg-white p-2 xl:flex">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-[#f1f1f1] bg-white">
        <PanelHeader connectionState={connectionState} onClose={() => setPreviewPanelOpen(false)} />
        <PanelTabs activePreviewTab={activePreviewTab} setActivePreviewTab={setActivePreviewTab} />
        <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto bg-white p-4">
          <PanelBody
            activePreviewTab={activePreviewTab}
            deviceFrame={deviceFrame}
            expoUrl={expoUrl}
            previewReloadToken={previewReloadToken}
            previewUrl={previewUrl}
            sandboxStatus={sandboxStatus}
            threadId={threadId}
          />
        </div>
      </div>
    </aside>
  );
}

function PanelHeader({
  connectionState,
  onClose,
}: {
  connectionState: string;
  onClose: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between px-4">
      <div className="flex items-center gap-2 text-[#707070] text-[14px]">
        <StatusDot isOnline={connectionState === "online"} />
      </div>
      <div className="flex items-center gap-3">
        <button
          aria-label="Close preview"
          className="flex h-8 w-8 items-center justify-center rounded-full text-[#8a8a8a] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function PanelTabs({
  activePreviewTab,
  setActivePreviewTab,
}: {
  activePreviewTab: PreviewTab;
  setActivePreviewTab: (tab: PreviewTab) => void;
}) {
  return (
    <div className="chat-scrollbar flex shrink-0 overflow-x-auto px-4 pb-2">
      <div className="flex rounded-full bg-[#f7f7f7] p-1">
        {TABS.map((tab) => (
          <button
            className={cn(
              "h-8 min-w-20 rounded-full px-4 text-[14px] transition-colors",
              activePreviewTab === tab.value
                ? "bg-white text-[#1b1b1b]"
                : "text-[#707070] hover:text-[#1b1b1b]",
            )}
            key={tab.value}
            onClick={() => setActivePreviewTab(tab.value)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PanelBody({
  activePreviewTab,
  deviceFrame,
  expoUrl,
  previewReloadToken,
  previewUrl,
  sandboxStatus,
  threadId,
}: {
  activePreviewTab: PreviewTab;
  deviceFrame: "browser" | "phone";
  expoUrl: string | null;
  previewReloadToken: number;
  previewUrl: string | null;
  sandboxStatus: string;
  threadId: string;
}) {
  return (
    <div className="h-full min-h-[520px]">
      <Activity mode={activePreviewTab === "app" ? "visible" : "hidden"}>
        <AppTab
          deviceFrame={deviceFrame}
          expoUrl={expoUrl}
          previewReloadToken={previewReloadToken}
          previewUrl={previewUrl}
          sandboxStatus={sandboxStatus}
          threadId={threadId}
        />
      </Activity>
      <Activity mode={activePreviewTab === "browser" ? "visible" : "hidden"}>
        <BrowserTakeoverTab sandboxStatus={sandboxStatus} threadId={threadId} />
      </Activity>
      <Activity mode={activePreviewTab === "terminal" ? "visible" : "hidden"}>
        <SandboxTerminalTab sandboxStatus={sandboxStatus} threadId={threadId} />
      </Activity>
      <Activity mode={activePreviewTab === "files" ? "visible" : "hidden"}>
        <SandboxFilesTab
          previewUrl={previewUrl}
          sandboxStatus={sandboxStatus}
          threadId={threadId}
        />
      </Activity>
      <Activity mode={activePreviewTab === "env" ? "visible" : "hidden"}>
        <SandboxEnvTab previewUrl={previewUrl} sandboxStatus={sandboxStatus} threadId={threadId} />
      </Activity>
    </div>
  );
}

function AppTab({
  deviceFrame,
  expoUrl,
  previewReloadToken,
  previewUrl,
  sandboxStatus,
  threadId,
}: {
  deviceFrame: "browser" | "phone";
  expoUrl: string | null;
  previewReloadToken: number;
  previewUrl: string | null;
  sandboxStatus: string;
  threadId: string;
}) {
  const previewPath = useAppStore((state) => state.previewPath);
  if (previewUrl) {
    const iframeUrl = buildPreviewIframeSrc(previewUrl, previewPath, previewReloadToken);
    return (
      <div className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-[16px] border border-[#f1f1f1] bg-white">
        <PreviewUrlBar previewUrl={previewUrl} />
        <div className="flex min-h-0 flex-1">
          <DeviceFrame frame={deviceFrame}>
            <iframe
              className="min-h-0 min-w-0 flex-1 bg-white"
              key={iframeUrl}
              referrerPolicy="no-referrer"
              sandbox="allow-forms allow-modals allow-popups allow-scripts allow-same-origin"
              src={iframeUrl}
              title="Sandbox preview"
            />
          </DeviceFrame>
          {expoUrl ? <ExpoDeviceTestPanel expoUrl={expoUrl} /> : null}
        </div>
        <ConsoleStrip previewUrl={previewUrl} threadId={threadId} />
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-[420px] place-items-center rounded-[16px] border border-[#f1f1f1] bg-[#fafafa]">
      <div className="text-center">
        <div className="mx-auto mb-4 h-2 w-2 rounded-full bg-thread-status-success shadow-[0_0_16px_var(--thread-status-success-glow)]" />
        <div className="text-[12px] text-thread-text-muted">Sandbox {sandboxStatus}</div>
        <div className="mt-3 text-sm text-thread-text-secondary">
          Sandbox output streams into chat.
        </div>
      </div>
    </div>
  );
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

function StatusDot({ isOnline }: { isOnline: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isOnline ? "bg-thread-status-success" : "bg-red-400",
        )}
      />
      <span className="text-[11px] text-thread-text-secondary tracking-[0.18em]">
        {isOnline ? "ONLINE" : "OFFLINE"}
      </span>
    </div>
  );
}
