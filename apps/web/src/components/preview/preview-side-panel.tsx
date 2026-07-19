"use client";

import type { ProjectSummary } from "@cheatcode/types";
import { Monitor, Smartphone } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { QRCodeSVG } from "qrcode.react";
import { Activity, type ReactNode, useEffect } from "react";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { PreviewSessionRefresh, useStablePreviewSource } from "@/lib/preview/preview-session";
import { buildPreviewIframeSrc } from "@/lib/preview/url-bar";
import { type PreviewLivePhase, useEnsurePreviewLive } from "@/lib/preview/use-ensure-preview-live";
import type { PreviewDevice, PreviewTab } from "@/lib/store/app-store";
import { useAppStore } from "@/lib/store/app-store";
import { emitFirstPreviewOpened } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";
import { BootingComputer } from "./booting-computer";
import { ComputerPanelTabs } from "./computer-panel-tabs";
import { ComputerSurfaceFrame } from "./computer-surface-frame";
import { ComputerToggleButton } from "./computer-toggle-button";
import { ConsoleStrip } from "./console-strip";
import { DeviceFrame } from "./device-frame";
import { PreviewUrlBar } from "./preview-url-bar";
import { SandboxIdeTab } from "./sandbox-ide-tab";
import { useBrowserTakeover } from "./use-browser-takeover";

const APP_PREVIEW_IFRAME_ALLOW = "autoplay; fullscreen";

const APP_PREVIEW_IFRAME_SANDBOX =
  "allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts";

interface PreviewSidePanelProps {
  activeRunId: string | null;
  deliverableCount: number;
  project: ProjectSummary | null;
  threadId: string;
}

type PreviewPanelContentProps = Omit<PreviewSidePanelProps, "activeRunId">;

export function PreviewSidePanel({
  activeRunId,
  deliverableCount,
  project,
  threadId,
}: PreviewSidePanelProps) {
  const controller = usePreviewPanelController(activeRunId, project, threadId);
  return (
    <PreviewPanelLayout
      controller={controller}
      deliverableCount={deliverableCount}
      project={project}
      threadId={threadId}
    />
  );
}

function usePreviewPanelController(
  activeRunId: string | null,
  project: ProjectSummary | null,
  threadId: string,
) {
  const { getToken } = useAuth();
  const store = usePreviewPanelStore();
  const isMobile = project?.mode === "app-builder-mobile" || store.expoUrl !== null;
  // The authenticated wake endpoint is the only source of preview capabilities. Opening any
  // project Computer panel asks it for a fresh handoff; projects without a dev server fall back to
  // Files. Daytona idle-stops are revived through the same path.
  const previewLive = useEnsurePreviewLive(
    threadId,
    getToken,
    store.previewPanelOpen && project !== null,
    store.sandboxStatus,
  );
  useFirstPreviewTelemetry(getToken, store.previewPanelOpen, store.previewUrl);
  const browserTakeover = useBrowserTakeover(activeRunId, threadId);
  useEffect(() => {
    if (!browserTakeover.session) return;
    store.setActivePreviewTab("app");
    store.setPreviewPanelOpen(true);
  }, [browserTakeover.session, store.setActivePreviewTab, store.setPreviewPanelOpen]);
  return { ...store, browserTakeover, isMobile, previewLive };
}

function usePreviewPanelStore() {
  return {
    activePreviewTab: useAppStore((state) => normalizeComputerTab(state.activePreviewTab)),
    expoUrl: useAppStore((state) => state.expoUrl),
    previewDevice: useAppStore((state) => state.previewDevice),
    previewPanelOpen: useAppStore((state) => state.previewPanelOpen),
    previewReloadToken: useAppStore((state) => state.previewReloadToken),
    previewUrl: useAppStore((state) => state.previewUrl),
    sandboxStatus: useAppStore((state) => state.sandboxStatus),
    setActivePreviewTab: useAppStore((state) => state.setActivePreviewTab),
    setPreviewPanelOpen: useAppStore((state) => state.setPreviewPanelOpen),
  };
}

function useFirstPreviewTelemetry(
  getToken: () => Promise<null | string>,
  previewPanelOpen: boolean,
  previewUrl: string | null,
): void {
  useEffect(() => {
    if (!previewUrl || !previewPanelOpen) {
      return;
    }
    void emitFirstPreviewOpened(getToken).catch(() => undefined);
  }, [getToken, previewPanelOpen, previewUrl]);
}

function PreviewPanelLayout({
  controller,
  deliverableCount,
  project,
  threadId,
}: PreviewPanelContentProps & { controller: ReturnType<typeof usePreviewPanelController> }) {
  return (
    <>
      <OpenPreviewPanelButton controller={controller} />
      <PreviewPanelAside
        controller={controller}
        deliverableCount={deliverableCount}
        project={project}
        threadId={threadId}
      />
    </>
  );
}

function OpenPreviewPanelButton({
  controller,
}: {
  controller: ReturnType<typeof usePreviewPanelController>;
}) {
  return (
    <CheatcodeTooltip
      className={cn(
        "max-md:hidden! fixed top-3.5 right-3.5 z-40 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none md:flex",
        controller.previewPanelOpen
          ? "pointer-events-none translate-y-0 scale-[0.98] opacity-0"
          : "translate-y-0 scale-100 opacity-100",
      )}
      label="Open computer"
      side="bottom"
    >
      <ComputerToggleButton
        active={false}
        aria-hidden={controller.previewPanelOpen}
        aria-label="Open computer"
        onClick={() => controller.setPreviewPanelOpen(true)}
        tabIndex={controller.previewPanelOpen ? -1 : undefined}
      />
    </CheatcodeTooltip>
  );
}

function PreviewPanelAside({
  controller,
  deliverableCount,
  project,
  threadId,
}: PreviewPanelContentProps & { controller: ReturnType<typeof usePreviewPanelController> }) {
  return (
    <aside
      aria-hidden={!controller.previewPanelOpen}
      className={previewPanelClass(controller.previewPanelOpen)}
      inert={controller.previewPanelOpen ? undefined : true}
    >
      <div className="flex h-full max-h-full w-full min-w-0 flex-col gap-2 overflow-hidden bg-background">
        <ComputerPanelTabs
          activePreviewTab={controller.activePreviewTab}
          deliverableCount={deliverableCount}
          projectId={project?.id ?? null}
          projectName={project?.name ?? null}
          browserTakeover={controller.browserTakeover}
          setActivePreviewTab={controller.setActivePreviewTab}
          setPreviewPanelOpen={controller.setPreviewPanelOpen}
        />
        <ComputerSurfaceFrame
          consoleStrip={previewConsoleStrip(controller.activePreviewTab, project, threadId)}
        >
          <PanelBody {...panelBodyProps(controller, project, threadId)} />
        </ComputerSurfaceFrame>
      </div>
    </aside>
  );
}

function previewPanelClass(isOpen: boolean): string {
  return cn(
    "cc-agent-computer-pane relative hidden min-h-0 min-w-0 overflow-hidden bg-background transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transform-none motion-reduce:transition-none md:flex",
    isOpen
      ? "translate-x-0 opacity-100 blur-0"
      : "pointer-events-none translate-x-3 opacity-0 blur-[1px]",
  );
}

function previewConsoleStrip(
  activeTab: PreviewTab,
  project: ProjectSummary | null,
  threadId: string,
) {
  return activeTab === "files" ? (
    <ConsoleStrip sandboxAvailable={project !== null} threadId={threadId} />
  ) : null;
}

function panelBodyProps(
  controller: ReturnType<typeof usePreviewPanelController>,
  project: ProjectSummary | null,
  threadId: string,
): PanelBodyProps {
  return {
    activePreviewTab: controller.activePreviewTab,
    computerOpen: controller.previewPanelOpen,
    device: controller.previewDevice,
    expoUrl: controller.expoUrl,
    hasProject: project !== null,
    isMobile: controller.isMobile,
    previewPhase: controller.previewLive.phase,
    previewRetry: controller.previewLive.retry,
    previewReloadToken: controller.previewReloadToken,
    previewUrl: controller.previewUrl,
    sandboxStatus: controller.sandboxStatus,
    browserTakeover: controller.browserTakeover,
    threadId,
  };
}

interface PanelBodyProps {
  activePreviewTab: PreviewTab;
  computerOpen: boolean;
  device: PreviewDevice;
  expoUrl: string | null;
  hasProject: boolean;
  isMobile: boolean;
  previewPhase: PreviewLivePhase;
  previewRetry: () => Promise<void>;
  previewReloadToken: number;
  previewUrl: string | null;
  sandboxStatus: string;
  threadId: string;
  browserTakeover: ReturnType<typeof useBrowserTakeover>;
}

function PanelBody({
  activePreviewTab,
  computerOpen,
  device,
  expoUrl,
  hasProject,
  isMobile,
  previewPhase,
  previewRetry,
  previewReloadToken,
  previewUrl,
  sandboxStatus,
  threadId,
  browserTakeover,
}: PanelBodyProps) {
  return (
    <div className="h-full min-h-0">
      <Activity mode={activePreviewTab === "app" ? "visible" : "hidden"}>
        {browserTakeover.session ? (
          <BrowserTakeoverSurface browserTakeover={browserTakeover} />
        ) : (
          <AppTab
            device={device}
            expoUrl={expoUrl}
            hasProject={hasProject}
            isMobile={isMobile}
            previewPhase={previewPhase}
            previewRetry={previewRetry}
            previewReloadToken={previewReloadToken}
            previewUrl={previewUrl}
            sandboxStatus={sandboxStatus}
          />
        )}
      </Activity>
      <Activity mode={activePreviewTab === "files" ? "visible" : "hidden"}>
        <SandboxIdeTab
          active={computerOpen && activePreviewTab === "files"}
          previewReloadToken={previewReloadToken}
          threadId={threadId}
        />
      </Activity>
    </div>
  );
}

type AppTabProps = Omit<
  PanelBodyProps,
  "activePreviewTab" | "browserTakeover" | "computerOpen" | "threadId"
>;

function BrowserTakeoverSurface({
  browserTakeover,
}: {
  browserTakeover: ReturnType<typeof useBrowserTakeover>;
}) {
  const session = browserTakeover.session;
  if (!session) return null;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20.5px] bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between border-border border-b px-3">
        <div className="flex items-center gap-2 font-medium text-[12px] text-fg-secondary">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-400" />
          You’re controlling the browser
        </div>
        <button
          className="h-7 rounded-full bg-foreground px-3 font-medium text-[12px] text-background transition-opacity hover:opacity-85 disabled:opacity-50"
          disabled={browserTakeover.isPending}
          onClick={() => void browserTakeover.resume()}
          type="button"
        >
          {browserTakeover.isPending ? "Resuming…" : "Resume Cheatcode"}
        </button>
      </div>
      <iframe
        allow="clipboard-read; clipboard-write; fullscreen"
        className="min-h-0 min-w-0 flex-1 border-0 bg-background"
        referrerPolicy="no-referrer"
        sandbox="allow-forms allow-pointer-lock allow-same-origin allow-scripts"
        src={session.url}
        title="Live browser takeover"
      />
    </div>
  );
}

function AppTab({
  device,
  expoUrl,
  hasProject,
  isMobile,
  previewPhase,
  previewRetry,
  previewReloadToken,
  previewUrl,
  sandboxStatus,
}: AppTabProps) {
  const previewPath = useAppStore((state) => state.previewPath);
  const requestedIframeUrl = requestedPreviewIframeUrl(previewUrl, previewPath, previewReloadToken);
  const iframeUrl =
    useStablePreviewSource(requestedIframeUrl) ?? requestedIframeUrl ?? "about:blank";
  const frameDevice: PreviewDevice = isMobile ? "phone" : device;
  if (
    previewPhase === "live" &&
    !previewUrl &&
    !hasProject &&
    (sandboxStatus === "cold" || sandboxStatus === "starting")
  ) {
    return <BootingComputer />;
  }
  return (
    <AppTabLayout expoUrl={expoUrl} isError={previewPhase === "error"} previewUrl={previewUrl}>
      <AppTabContent
        frameDevice={frameDevice}
        iframeUrl={iframeUrl}
        previewPhase={previewPhase}
        previewRetry={previewRetry}
        previewUrl={previewUrl}
        requestedIframeUrl={requestedIframeUrl}
      />
    </AppTabLayout>
  );
}

function AppTabLayout({
  children,
  expoUrl,
  isError,
  previewUrl,
}: {
  children: ReactNode;
  expoUrl: string | null;
  isError: boolean;
  previewUrl: string | null;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <PreviewUrlBar previewUrl={previewUrl} />
      <div
        className={cn(
          "relative flex min-h-0 flex-1 overflow-hidden rounded-[20.5px]",
          isError ? "bg-bg-secondary" : null,
        )}
      >
        {children}
        {expoUrl ? <ExpoDeviceTestPanel expoUrl={expoUrl} /> : null}
      </div>
    </div>
  );
}

function AppTabContent({
  frameDevice,
  iframeUrl,
  previewPhase,
  previewRetry,
  previewUrl,
  requestedIframeUrl,
}: {
  frameDevice: PreviewDevice;
  iframeUrl: string;
  previewPhase: PreviewLivePhase;
  previewRetry: () => Promise<void>;
  previewUrl: string | null;
  requestedIframeUrl: string | null;
}) {
  if (previewPhase === "booting") {
    return (
      <PreviewDeviceFrame
        device={frameDevice}
        content={<BootingComputer label="Starting preview…" />}
      />
    );
  }
  if (previewPhase === "error") {
    return (
      <PreviewDeviceFrame
        device={frameDevice}
        content={<PreviewWakeError onRetry={previewRetry} />}
      />
    );
  }
  if (previewUrl) {
    return (
      <>
        <PreviewSessionRefresh previewUrl={requestedIframeUrl} />
        <PreviewDeviceFrame
          device={frameDevice}
          content={<BrowserPreviewIframe iframeUrl={iframeUrl} />}
        />
      </>
    );
  }
  return <PreviewDeviceFrame device={frameDevice} content={<EmptyAppPreview />} />;
}

function PreviewDeviceFrame({ content, device }: { content: ReactNode; device: PreviewDevice }) {
  return <DeviceFrame device={device}>{content}</DeviceFrame>;
}

function BrowserPreviewIframe({ iframeUrl }: { iframeUrl: string }) {
  return (
    <iframe
      className="min-h-0 min-w-0 flex-1 border-0 bg-background"
      key={iframeUrl}
      allow={APP_PREVIEW_IFRAME_ALLOW}
      allowFullScreen
      referrerPolicy="origin"
      sandbox={APP_PREVIEW_IFRAME_SANDBOX}
      src={iframeUrl}
      title="Browser preview"
    />
  );
}

function EmptyAppPreview() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-background font-medium text-[14px] text-fg-secondary">
      Running app previews will appear here.
    </div>
  );
}

function requestedPreviewIframeUrl(
  previewUrl: string | null,
  previewPath: string,
  previewReloadToken: number,
): string | null {
  return previewUrl ? buildPreviewIframeSrc(previewUrl, previewPath, previewReloadToken) : null;
}

function normalizeComputerTab(tab: PreviewTab): PreviewTab {
  return tab === "files" ? "files" : "app";
}

function PreviewWakeError({ onRetry }: { onRetry: () => Promise<void> }) {
  return (
    <div className="flex min-h-[420px] min-w-0 flex-1 items-center justify-center bg-bg-secondary p-5">
      <RecoveryCard
        action={{ label: "Retry preview", onClick: () => void onRetry() }}
        announce="assertive"
        description="The computer is available, but the app server didn't come back online."
        icon={Monitor}
        title="Preview didn't start"
      />
    </div>
  );
}

function ExpoDeviceTestPanel({ expoUrl }: { expoUrl: string }) {
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
