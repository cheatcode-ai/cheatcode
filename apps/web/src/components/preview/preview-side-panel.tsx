"use client";

import type { ProjectSummary } from "@cheatcode/types/api";
import { useAuth } from "@clerk/nextjs";
import { Activity, type ReactNode, useEffect, useState } from "react";
import { BrowserTakeoverSurface } from "@/components/preview/browser-takeover-surface";
import { ExpoDevicePanel } from "@/components/preview/expo-device-panel";
import {
  PreviewSessionRefresh,
  useStablePreviewSource,
} from "@/components/preview/preview-session";
import { buildPreviewIframeSrc } from "@/components/preview/url-bar";
import {
  type PreviewLivePhase,
  useEnsurePreviewLive,
} from "@/components/preview/use-ensure-preview-live";
import { Monitor } from "@/components/ui";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import { RecoveryCard } from "@/components/ui/recovery-card";
import type { PreviewDevice, PreviewTab } from "@/lib/store/app-store";
import { useAppStore } from "@/lib/store/app-store";
import { emitFirstPreviewOpened } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";
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
  return { ...store, browserTakeover, isMobile, isRunActive: activeRunId !== null, previewLive };
}

function usePreviewPanelStore() {
  return {
    activePreviewTab: useAppStore((state) => normalizeComputerTab(state.activePreviewTab)),
    appPreviewStatus: useAppStore((state) => state.appPreviewStatus),
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
    appPreviewStatus: controller.appPreviewStatus,
    computerOpen: controller.previewPanelOpen,
    device: controller.previewDevice,
    expoUrl: controller.expoUrl,
    hasProject: project !== null,
    isMobile: controller.isMobile,
    isRunActive: controller.isRunActive,
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
  appPreviewStatus: ReturnType<typeof useAppStore.getState>["appPreviewStatus"];
  computerOpen: boolean;
  device: PreviewDevice;
  expoUrl: string | null;
  hasProject: boolean;
  isMobile: boolean;
  isRunActive: boolean;
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
  appPreviewStatus,
  computerOpen,
  device,
  expoUrl,
  hasProject,
  isMobile,
  isRunActive,
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
            appPreviewStatus={appPreviewStatus}
            isMobile={isMobile}
            isRunActive={isRunActive}
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

function AppTab({
  appPreviewStatus,
  device,
  expoUrl,
  hasProject,
  isMobile,
  isRunActive,
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
    return (
      <CheatcodeLoader
        className="h-full min-h-[420px] min-w-0 flex-1 bg-bg-secondary"
        label="Booting computer"
      />
    );
  }
  return (
    <AppTabLayout expoUrl={expoUrl} isError={previewPhase === "error"} previewUrl={previewUrl}>
      <AppTabContent
        frameDevice={frameDevice}
        iframeUrl={iframeUrl}
        isGeneratedPreviewPending={appPreviewStatus === "building" && isRunActive}
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
        {expoUrl ? <ExpoDevicePanel expoUrl={expoUrl} /> : null}
      </div>
    </div>
  );
}

function AppTabContent({
  frameDevice,
  iframeUrl,
  isGeneratedPreviewPending,
  previewPhase,
  previewRetry,
  previewUrl,
  requestedIframeUrl,
}: {
  frameDevice: PreviewDevice;
  iframeUrl: string;
  isGeneratedPreviewPending: boolean;
  previewPhase: PreviewLivePhase;
  previewRetry: () => Promise<void>;
  previewUrl: string | null;
  requestedIframeUrl: string | null;
}) {
  if (previewPhase === "booting" || isGeneratedPreviewPending) {
    return (
      <PreviewDeviceFrame
        device={frameDevice}
        content={
          <CheatcodeLoader
            className="h-full min-h-[420px] min-w-0 flex-1 bg-bg-secondary"
            label={isGeneratedPreviewPending ? "Building preview…" : "Starting preview…"}
          />
        }
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
  const [isLoaded, setIsLoaded] = useState(false);
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 bg-background">
      {!isLoaded ? (
        <CheatcodeLoader
          className="absolute inset-0 z-10 bg-bg-secondary"
          label="Loading preview…"
        />
      ) : null}
      <iframe
        className={cn(
          "min-h-0 min-w-0 flex-1 border-0 bg-background transition-opacity duration-150 motion-reduce:transition-none",
          isLoaded ? "opacity-100" : "opacity-0",
        )}
        key={iframeUrl}
        allow={APP_PREVIEW_IFRAME_ALLOW}
        allowFullScreen
        onLoad={() => setIsLoaded(true)}
        referrerPolicy="origin"
        sandbox={APP_PREVIEW_IFRAME_SANDBOX}
        src={iframeUrl}
        title="Browser preview"
      />
    </div>
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
