"use client";

import type { ProjectSummary } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { QRCodeSVG } from "qrcode.react";
import { Activity, useEffect } from "react";
import { Inbox, Monitor, MoreHorizontal } from "@/components/ui/icons";
import { buildPreviewIframeSrc } from "@/lib/preview/url-bar";
import type { PreviewDevice, PreviewTab } from "@/lib/store/app-store";
import { useAppStore } from "@/lib/store/app-store";
import { emitFirstPreviewOpened } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";
import { BootingComputer } from "./booting-computer";
import { ConsoleStrip } from "./console-strip";
import { DeviceFrame } from "./device-frame";
import { PreviewUrlBar } from "./preview-url-bar";
import { SandboxFilesTab } from "./sandbox-files-tab";

const TABS: ReadonlyArray<{ label: string; value: PreviewTab }> = [
  { label: "Files", value: "files" },
  { label: "Browser", value: "app" },
];

export function PreviewSidePanel({
  project,
  threadId,
}: {
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
        aria-label="Open computer"
        className="fixed top-3.5 right-3.5 z-40 hidden h-7 items-center gap-1.5 rounded-full bg-[#1b1b1b] py-1 pr-3 pl-2.5 font-medium text-[14px] text-white transition-colors hover:bg-black md:flex"
        onClick={() => setPreviewPanelOpen(true)}
        type="button"
      >
        <Monitor aria-hidden="true" className="h-4 w-4" />
        <span>Computer</span>
      </button>
    );
  }

  return (
    <aside className="hidden min-h-0 min-w-0 bg-white md:flex">
      <div className="flex h-full max-h-full w-full min-w-0 flex-col gap-2 overflow-hidden bg-white">
        <PanelTabs
          activePreviewTab={activePreviewTab}
          projectName={project?.name ?? null}
          setActivePreviewTab={setActivePreviewTab}
          setPreviewPanelOpen={setPreviewPanelOpen}
        />
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[24px] border-2 border-[#f1f1f1] bg-white">
          <div className="min-h-0 flex-1">
            <PanelBody
              activePreviewTab={activePreviewTab}
              device={previewDevice}
              expoUrl={expoUrl}
              previewReloadToken={previewReloadToken}
              previewUrl={previewUrl}
              sandboxStatus={sandboxStatus}
              threadId={threadId}
            />
          </div>
          {activePreviewTab === "files" ? <ConsoleStrip threadId={threadId} /> : null}
        </div>
      </div>
    </aside>
  );
}

function PanelTabs({
  activePreviewTab,
  projectName,
  setActivePreviewTab,
  setPreviewPanelOpen,
}: {
  activePreviewTab: PreviewTab;
  projectName: string | null;
  setActivePreviewTab: (tab: PreviewTab) => void;
  setPreviewPanelOpen: (open: boolean) => void;
}) {
  return (
    <div className="hidden h-12 w-full shrink-0 items-center justify-between overflow-x-auto px-[3px] md:flex">
      <div className="flex">
        {TABS.map((tab) => (
          <button
            aria-selected={activePreviewTab === tab.value}
            className={cn(
              "flex h-7 items-center justify-center whitespace-nowrap rounded-full px-3 font-medium text-[14px] transition-colors",
              activePreviewTab === tab.value
                ? "bg-white text-[#1b1b1b] shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                : "text-[#5f5f5f] hover:text-[#1b1b1b]",
            )}
            key={tab.value}
            onClick={() => setActivePreviewTab(tab.value)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1 pr-1">
        <button
          aria-label="More actions"
          className="flex h-7 w-7 items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
          type="button"
        >
          <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          aria-label="Close computer"
          className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#1b1b1b] py-1 pr-3 pl-2.5 font-medium text-[14px] text-white transition-colors hover:bg-black"
          onClick={() => setPreviewPanelOpen(false)}
          type="button"
        >
          <Monitor aria-hidden="true" className="h-4 w-4" />
          <span>Computer</span>
        </button>
        <button
          aria-label={projectName ? `View deliverables for ${projectName}` : "View deliverables"}
          className="flex h-7 items-center gap-1 rounded-full px-1.5 font-medium text-[#1b1b1b] text-[12px] transition-colors hover:bg-[#f7f7f7]"
          type="button"
        >
          <Inbox aria-hidden="true" className="h-4 w-4" />
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[#1b1b1b] px-1 text-[10px] text-white leading-none">
            2
          </span>
        </button>
      </div>
    </div>
  );
}

function PanelBody({
  activePreviewTab,
  device,
  expoUrl,
  previewReloadToken,
  previewUrl,
  sandboxStatus,
  threadId,
}: {
  activePreviewTab: PreviewTab;
  device: PreviewDevice;
  expoUrl: string | null;
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
          previewReloadToken={previewReloadToken}
          previewUrl={previewUrl}
          sandboxStatus={sandboxStatus}
        />
      </Activity>
      <Activity mode={activePreviewTab === "files" ? "visible" : "hidden"}>
        <SandboxFilesTab
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
  previewReloadToken,
  previewUrl,
  sandboxStatus,
}: {
  device: PreviewDevice;
  expoUrl: string | null;
  previewReloadToken: number;
  previewUrl: string | null;
  sandboxStatus: string;
}) {
  const previewPath = useAppStore((state) => state.previewPath);
  if (previewUrl) {
    const iframeUrl = buildPreviewIframeSrc(previewUrl, previewPath, previewReloadToken);
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white p-0.5">
        <PreviewUrlBar previewUrl={previewUrl} />
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-[20.5px]">
          <DeviceFrame device={device}>
            <iframe
              className="min-h-0 min-w-0 flex-1 border-0 bg-white"
              key={iframeUrl}
              referrerPolicy="no-referrer"
              sandbox="allow-forms allow-modals allow-popups allow-scripts allow-same-origin"
              src={iframeUrl}
              title="Sandbox preview"
            />
          </DeviceFrame>
          {expoUrl ? <ExpoDeviceTestPanel expoUrl={expoUrl} /> : null}
        </div>
      </div>
    );
  }

  if (sandboxStatus === "cold" || sandboxStatus === "starting") {
    return <BootingComputer />;
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
