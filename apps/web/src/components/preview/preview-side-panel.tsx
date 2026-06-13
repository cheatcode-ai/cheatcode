"use client";

import { useAuth } from "@clerk/nextjs";
import { QRCodeSVG } from "qrcode.react";
import { Activity, useEffect } from "react";
import { ExternalLink, PanelRightOpen, X } from "@/components/ui/icons";
import type { PreviewTab } from "@/lib/store/app-store";
import { useAppStore } from "@/lib/store/app-store";
import { emitFirstPreviewOpened } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";
import { BrowserTakeoverTab } from "./browser-takeover-tab";
import { SandboxEnvTab } from "./sandbox-env-tab";
import { SandboxFilesTab } from "./sandbox-files-tab";
import { SandboxTerminalTab } from "./sandbox-terminal-tab";

const TABS: ReadonlyArray<{ label: string; value: PreviewTab }> = [
  { label: "Preview", value: "app" },
  { label: "Files", value: "files" },
  { label: "Env", value: "env" },
  { label: "Browser", value: "browser" },
  { label: "Terminal", value: "terminal" },
];

export function PreviewSidePanel({ threadId }: { threadId: string }) {
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
        className="fixed top-1/2 right-6 z-40 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/80 text-zinc-500 shadow-2xl backdrop-blur-md transition-colors hover:bg-zinc-900 hover:text-white"
        onClick={() => setPreviewPanelOpen(true)}
        type="button"
      >
        <PanelRightOpen aria-hidden="true" className="h-5 w-5" />
      </button>
    );
  }

  return (
    <aside className="fixed top-14 right-0 bottom-0 z-30 flex w-[65vw] min-w-[720px] flex-col border-thread-border-subtle border-l bg-thread-panel-translucent shadow-[-24px_0_80px_rgba(0,0,0,0.35)] backdrop-blur-md">
      <PanelHeader connectionState={connectionState} onClose={() => setPreviewPanelOpen(false)} />
      <PanelTabs activePreviewTab={activePreviewTab} setActivePreviewTab={setActivePreviewTab} />
      <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        <PanelBody
          activePreviewTab={activePreviewTab}
          expoUrl={expoUrl}
          previewReloadToken={previewReloadToken}
          previewUrl={previewUrl}
          sandboxStatus={sandboxStatus}
          threadId={threadId}
        />
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
    <div className="flex h-14 shrink-0 items-center justify-between border-thread-border-subtle border-b px-4">
      <div className="font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.24em]">
        App Surface
      </div>
      <div className="flex items-center gap-3">
        <StatusDot isOnline={connectionState === "online"} />
        <button
          aria-label="Close preview"
          className="flex h-8 w-8 items-center justify-center rounded-sm text-thread-text-tertiary transition-colors hover:bg-thread-hover hover:text-thread-text-primary"
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
    <div className="chat-scrollbar flex shrink-0 overflow-x-auto border-thread-border-subtle border-b p-2">
      {TABS.map((tab) => (
        <button
          className={cn(
            "h-9 min-w-24 flex-1 px-3 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors",
            activePreviewTab === tab.value
              ? "bg-thread-surface text-thread-text-primary"
              : "text-thread-text-tertiary hover:bg-thread-hover hover:text-thread-text-secondary",
          )}
          key={tab.value}
          onClick={() => setActivePreviewTab(tab.value)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function PanelBody({
  activePreviewTab,
  expoUrl,
  previewReloadToken,
  previewUrl,
  sandboxStatus,
  threadId,
}: {
  activePreviewTab: PreviewTab;
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
          expoUrl={expoUrl}
          previewReloadToken={previewReloadToken}
          previewUrl={previewUrl}
          sandboxStatus={sandboxStatus}
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
  expoUrl,
  previewReloadToken,
  previewUrl,
  sandboxStatus,
}: {
  expoUrl: string | null;
  previewReloadToken: number;
  previewUrl: string | null;
  sandboxStatus: string;
}) {
  if (previewUrl) {
    const iframeUrl = previewUrlWithReloadToken(previewUrl, previewReloadToken);
    return (
      <div className="flex h-full min-h-[520px] flex-col border border-thread-border bg-black">
        <div className="flex h-10 shrink-0 items-center justify-between border-thread-border-subtle border-b px-3">
          <div className="min-w-0 truncate font-mono text-[10px] text-thread-text-secondary">
            {previewUrl}
          </div>
          <a
            aria-label="Open preview in a new tab"
            className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center border border-thread-border text-thread-text-secondary transition-colors hover:bg-thread-hover hover:text-thread-text-primary"
            href={previewUrl}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="flex min-h-0 flex-1">
          <iframe
            className="min-h-0 min-w-0 flex-1 bg-white"
            key={iframeUrl}
            referrerPolicy="no-referrer"
            sandbox="allow-forms allow-modals allow-popups allow-scripts allow-same-origin"
            src={iframeUrl}
            title="Sandbox preview"
          />
          {expoUrl ? <ExpoDeviceTestPanel expoUrl={expoUrl} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-[420px] place-items-center border border-thread-border bg-black/30">
      <div className="text-center">
        <div className="mx-auto mb-4 h-2 w-2 rounded-full bg-thread-status-success shadow-[0_0_16px_var(--thread-status-success-glow)]" />
        <div className="font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.28em]">
          Sandbox {sandboxStatus}
        </div>
        <div className="mt-3 font-mono text-sm text-thread-text-secondary">
          Blaxel sandbox output streams into chat.
        </div>
      </div>
    </div>
  );
}

function ExpoDeviceTestPanel({ expoUrl }: { expoUrl: string }) {
  return (
    <aside
      aria-label="Test on your device"
      className="chat-scrollbar flex w-[248px] shrink-0 flex-col gap-4 overflow-y-auto border-thread-border-subtle border-l bg-thread-panel p-4"
    >
      <div className="font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.22em]">
        Test on your device
      </div>
      <div className="flex items-center justify-center border border-thread-border bg-white p-3">
        <QRCodeSVG level="M" size={168} title="Expo Go QR code" value={expoUrl} />
      </div>
      <ol className="space-y-3">
        <li className="flex gap-2.5">
          <span className="font-mono text-[10px] text-thread-text-muted">1.</span>
          <div className="min-w-0">
            <div className="font-mono text-[11px] text-thread-text-primary">Install Expo Go</div>
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
          <span className="font-mono text-[10px] text-thread-text-muted">2.</span>
          <div className="min-w-0">
            <div className="font-mono text-[11px] text-thread-text-primary">
              Scan with your camera
            </div>
            <div className="mt-0.5 text-[11px] text-thread-text-secondary leading-relaxed">
              Use your camera or the Expo Go app. The build opens on your phone and live-reloads as
              the agent works.
            </div>
          </div>
        </li>
      </ol>
      <div className="min-w-0 border border-thread-border bg-black/30 p-2">
        <div className="break-all font-mono text-[10px] text-thread-text-secondary">{expoUrl}</div>
      </div>
      <p className="text-[10px] text-thread-text-tertiary leading-relaxed">
        The in-browser preview approximates native rendering. For accurate results, test on a real
        device.
      </p>
    </aside>
  );
}

function previewUrlWithReloadToken(previewUrl: string, reloadToken: number): string {
  if (reloadToken === 0) {
    return previewUrl;
  }
  const url = new URL(previewUrl);
  url.searchParams.set("cc_preview_reload", String(reloadToken));
  return url.toString();
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
      <span className="font-mono text-[9px] text-thread-text-secondary tracking-[0.22em]">
        {isOnline ? "ONLINE" : "OFFLINE"}
      </span>
    </div>
  );
}
