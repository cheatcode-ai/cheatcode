"use client";

import { FolderOpen } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { type RefObject, useEffect, useRef, useState } from "react";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { openComputerIde, openSandboxIde } from "@/lib/api/sandbox";
import { PreviewSessionRefresh, useStablePreviewSource } from "@/lib/preview/preview-session";
import { cn } from "@/lib/ui/cn";

const PREVIEW_SESSION_REFRESH_MS = 8 * 60 * 1000;
const CODE_SERVER_HANDSHAKE_INTERVAL_MS = 750;
const CODE_SERVER_READY_TIMEOUT_MS = 30_000;
const CODE_SERVER_IFRAME_SANDBOX =
  "allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts";

function codeServerIframeUrl(
  url: string,
  previewReloadToken: number,
  frameReloadToken: number,
  theme: "dark" | "light",
): string {
  const parsed = new URL(url);
  parsed.searchParams.set("cc_theme", theme);
  if (previewReloadToken !== 0) {
    parsed.searchParams.set("cc_preview_reload", String(previewReloadToken));
  }
  if (frameReloadToken !== 0) {
    parsed.searchParams.set("cc_files_reload", String(frameReloadToken));
  }
  return parsed.toString();
}

export function SandboxIdeTab({
  active,
  previewReloadToken,
  threadId,
}: {
  active: boolean;
  previewReloadToken: number;
  threadId: string | null;
}) {
  const { getToken } = useAuth();
  const { resolvedTheme } = useTheme();
  const [frameReloadToken, setFrameReloadToken] = useState(0);
  const ideQuery = useSandboxIdeQuery(active, threadId, getToken);
  const requestedIframeUrl = ideQuery.data
    ? codeServerIframeUrl(
        ideQuery.data.url,
        previewReloadToken,
        frameReloadToken,
        resolvedTheme === "dark" ? "dark" : "light",
      )
    : null;
  const iframeUrl = useStablePreviewSource(requestedIframeUrl);
  const bridge = useCodeServerBridge(active, iframeUrl, threadId);
  const refetchSession = () => void ideQuery.refetch();
  const reloadFrame = () => setFrameReloadToken((current) => current + 1);
  return (
    <SandboxIdeContent
      bridge={bridge}
      ideQuery={ideQuery}
      iframeUrl={iframeUrl}
      onFrameRetry={reloadFrame}
      onSessionRetry={refetchSession}
      requestedIframeUrl={requestedIframeUrl}
    />
  );
}

function useSandboxIdeQuery(
  active: boolean,
  threadId: string | null,
  getToken: () => Promise<null | string>,
) {
  // Files resolves either the per-user computer root or the active project folder.
  return useQuery({
    enabled: active,
    queryFn: ({ signal }) =>
      threadId === null
        ? openComputerIde(getToken, signal)
        : openSandboxIde(getToken, threadId, signal),
    queryKey: ["sandbox-ide", threadId ?? "computer"],
    refetchInterval: (query) =>
      (query?.state.fetchFailureCount ?? 0) > 0 ? 60_000 : PREVIEW_SESSION_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 40 * 60 * 1000,
  });
}

function SandboxIdeContent({
  bridge,
  ideQuery,
  iframeUrl,
  onFrameRetry,
  onSessionRetry,
  requestedIframeUrl,
}: {
  bridge: ReturnType<typeof useCodeServerBridge>;
  ideQuery: ReturnType<typeof useSandboxIdeQuery>;
  iframeUrl: string | null;
  onFrameRetry: () => void;
  onSessionRetry: () => void;
  requestedIframeUrl: string | null;
}) {
  if (ideQuery.isPending) {
    return <IdePlaceholder label="Opening Files" />;
  }
  if (ideQuery.isError) {
    return <IdeError isRetrying={ideQuery.isFetching} onRetry={onSessionRetry} />;
  }

  if (!iframeUrl) {
    return <IdePlaceholder label="Opening Files" />;
  }
  return (
    <SandboxIdeFrame
      bridge={bridge}
      iframeUrl={iframeUrl}
      isRetrying={ideQuery.isFetching}
      onRetry={onFrameRetry}
      requestedIframeUrl={requestedIframeUrl}
    />
  );
}

function SandboxIdeFrame({
  bridge,
  iframeUrl,
  isRetrying,
  onRetry,
  requestedIframeUrl,
}: {
  bridge: ReturnType<typeof useCodeServerBridge>;
  iframeUrl: string;
  isRetrying: boolean;
  onRetry: () => void;
  requestedIframeUrl: string | null;
}) {
  if (bridge.hasTimedOut) {
    return <IdeError isRetrying={isRetrying} onRetry={onRetry} />;
  }
  return (
    <div className="relative h-full w-full">
      <PreviewSessionRefresh previewUrl={requestedIframeUrl} />
      {bridge.isReady ? (
        <CheatcodeTooltip
          className="absolute top-1 left-1.5 z-20"
          label="Toggle file explorer"
          side="right"
        >
          <button
            aria-expanded={bridge.sidebarVisible}
            aria-label="Toggle file explorer"
            className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-full p-1.5 text-fg-secondary transition-colors duration-150 hover:bg-background hover:text-foreground"
            onClick={bridge.toggleSidebar}
            type="button"
          >
            <FileExplorerToggleIcon visible={bridge.sidebarVisible} />
          </button>
        </CheatcodeTooltip>
      ) : null}
      <div className="h-full w-full">
        {!bridge.isReady ? (
          <CheatcodeLoader
            className="absolute inset-0 z-10 rounded-[20.5px] bg-bg-secondary"
            label="Opening Files"
          />
        ) : null}
        <iframe
          allow="clipboard-read; clipboard-write; cross-origin-isolated"
          className={cn(
            "h-full w-full rounded-[20.5px] border-0 transition-opacity duration-300 ease-out",
            bridge.isReady ? "opacity-100" : "opacity-0",
          )}
          key={iframeUrl}
          onLoad={bridge.requestReadyState}
          ref={bridge.iframeRef}
          referrerPolicy="origin"
          sandbox={CODE_SERVER_IFRAME_SANDBOX}
          src={iframeUrl}
          title="Code Server"
        />
      </div>
    </div>
  );
}

function useCodeServerBridge(active: boolean, iframeUrl: string | null, threadId: string | null) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [readyIframeUrl, setReadyIframeUrl] = useState<string | null>(null);
  const [timedOutIframeUrl, setTimedOutIframeUrl] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const iframeOrigin = readUrlOrigin(iframeUrl);
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      handleCodeServerMessage(event, {
        iframeOrigin,
        iframeUrl,
        iframeRef,
        setReadyIframeUrl,
        setSidebarVisible,
        setTimedOutIframeUrl,
        threadId,
      });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [iframeOrigin, iframeUrl, threadId]);
  const isReady = iframeUrl !== null && readyIframeUrl === iframeUrl;
  const requestReadyState = () => requestCodeServerState(iframeOrigin, iframeRef);
  useCodeServerHandshake({
    active,
    iframeOrigin,
    iframeRef,
    iframeUrl,
    isReady,
    setTimedOutIframeUrl,
  });
  const toggleSidebar = () => {
    if (!iframeOrigin) return;
    iframeRef.current?.contentWindow?.postMessage(
      { collapsed: sidebarVisible, type: "CHEATCODE_SET_SIDEBAR_COLLAPSED" },
      iframeOrigin,
    );
  };
  return {
    hasTimedOut: iframeUrl !== null && timedOutIframeUrl === iframeUrl,
    iframeRef,
    isReady,
    requestReadyState,
    sidebarVisible,
    toggleSidebar,
  };
}

function useCodeServerHandshake(input: {
  active: boolean;
  iframeOrigin: string | null;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  iframeUrl: string | null;
  isReady: boolean;
  setTimedOutIframeUrl: (iframeUrl: string | null) => void;
}): void {
  const { active, iframeOrigin, iframeRef, iframeUrl, isReady, setTimedOutIframeUrl } = input;
  useEffect(() => {
    if (!active || !iframeOrigin || !iframeUrl || isReady) return;
    setTimedOutIframeUrl(null);
    requestCodeServerState(iframeOrigin, iframeRef);
    const interval = window.setInterval(
      () => requestCodeServerState(iframeOrigin, iframeRef),
      CODE_SERVER_HANDSHAKE_INTERVAL_MS,
    );
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval);
      setTimedOutIframeUrl(iframeUrl);
    }, CODE_SERVER_READY_TIMEOUT_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [active, iframeOrigin, iframeRef, iframeUrl, isReady, setTimedOutIframeUrl]);
}

function requestCodeServerState(
  iframeOrigin: string | null,
  iframeRef: RefObject<HTMLIFrameElement | null>,
): void {
  if (!iframeOrigin) return;
  iframeRef.current?.contentWindow?.postMessage(
    { type: "CHEATCODE_REQUEST_CODE_SERVER_STATE" },
    iframeOrigin,
  );
}

function handleCodeServerMessage(
  event: MessageEvent,
  input: {
    iframeOrigin: string | null;
    iframeUrl: string | null;
    iframeRef: RefObject<HTMLIFrameElement | null>;
    setReadyIframeUrl: (iframeUrl: string | null) => void;
    setSidebarVisible: (visible: boolean) => void;
    setTimedOutIframeUrl: (iframeUrl: string | null) => void;
    threadId: string | null;
  },
): void {
  const iframeOrigin = input.iframeOrigin;
  if (!iframeOrigin || !isTrustedCodeServerMessage(event, iframeOrigin, input.iframeRef)) return;
  if (event.data.type === "CHEATCODE_SIDEBAR_STATE") {
    input.setSidebarVisible(event.data.visible === true);
  }
  if (event.data.type === "CHEATCODE_CODE_SERVER_READY") {
    input.setReadyIframeUrl(input.iframeUrl);
    input.setTimedOutIframeUrl(null);
    if (input.threadId === null) {
      input.iframeRef.current?.contentWindow?.postMessage(
        { type: "CHEATCODE_RESET_WORKSPACE_VIEW" },
        iframeOrigin,
      );
    }
  }
}

function isTrustedCodeServerMessage(
  event: MessageEvent,
  iframeOrigin: string,
  iframeRef: RefObject<HTMLIFrameElement | null>,
): event is MessageEvent<CodeServerMessage> {
  return Boolean(
    event.source === iframeRef.current?.contentWindow &&
      event.origin === iframeOrigin &&
      isCodeServerMessage(event.data),
  );
}

type CodeServerMessage =
  | { readonly type: "CHEATCODE_CODE_SERVER_READY" }
  | { readonly type: "CHEATCODE_SIDEBAR_STATE"; readonly visible: boolean };

function isCodeServerMessage(value: unknown): value is CodeServerMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  if (value.type === "CHEATCODE_CODE_SERVER_READY") {
    return true;
  }
  return (
    value.type === "CHEATCODE_SIDEBAR_STATE" &&
    "visible" in value &&
    typeof value.visible === "boolean"
  );
}

function readUrlOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function FileExplorerToggleIcon({ visible }: { visible: boolean }) {
  const dividerPath = visible ? "M5.67 12.25V1.75" : "M4.67 9.336V4.67";
  return (
    <svg
      aria-hidden="true"
      className="overflow-visible text-fg-secondary"
      fill="none"
      height="14"
      viewBox="0 0 14 14"
      width="14"
    >
      <path
        className="transition-[d] duration-300 ease-in-out motion-reduce:transition-none"
        d={`M6.417 1.75h1.166c2.2 0 3.3 0 3.984.683.683.684.683 1.784.683 3.984v1.166c0 2.2 0 3.3-.683 3.984-.684.683-1.784.683-3.984.683H6.417c-2.2 0-3.3 0-3.984-.683-.683-.684-.683-1.784-.683-3.984V6.417c0-2.2 0-3.3.683-3.984.684-.683 1.784-.683 3.984-.683${dividerPath}`}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function IdePlaceholder({ label }: { label: string }) {
  return <CheatcodeLoader className="h-full min-h-[420px] bg-bg-secondary" label={label} />;
}

function IdeError({ isRetrying, onRetry }: { isRetrying: boolean; onRetry: () => void }) {
  return (
    <div className="grid h-full min-h-[420px] place-items-center bg-bg-secondary p-5">
      <RecoveryCard
        action={{
          isPending: isRetrying,
          label: "Try again",
          onClick: onRetry,
          pendingLabel: "Opening Files…",
        }}
        announce="assertive"
        description="The computer couldn't connect to Files. Try opening it again."
        icon={FolderOpen}
        title="Files couldn't open"
      />
    </div>
  );
}
