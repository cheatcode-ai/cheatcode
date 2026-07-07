"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { BudTooltip } from "@/components/ui/bud-tooltip";
import { PanelLeftOpen } from "@/components/ui/icons";
import { openSandboxIde } from "@/lib/api/sandbox";
import { cn } from "@/lib/ui/cn";

function codeServerIframeUrl(url: string, reloadToken: number): string {
  if (reloadToken === 0) {
    return url;
  }
  const parsed = new URL(url);
  parsed.searchParams.set("cc_preview_reload", String(reloadToken));
  return parsed.toString();
}

export function SandboxIdeTab({
  active,
  hasProject,
  previewReloadToken,
  sandboxStatus,
  threadId,
}: {
  active: boolean;
  hasProject: boolean;
  previewReloadToken: number;
  previewUrl: string | null;
  sandboxStatus: string;
  threadId: string;
}) {
  const { getToken } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const sandboxReady = hasProject || sandboxStatus === "ready";
  const ideQuery = useQuery({
    enabled: active && sandboxReady,
    queryFn: () => openSandboxIde(getToken, threadId),
    queryKey: ["sandbox-ide", threadId],
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 55 * 60 * 1000,
  });

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== "CHEATCODE_SIDEBAR_STATE") {
        return;
      }
      setSidebarVisible(event.data.visible === true);
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const toggleSidebar = () => {
    setSidebarVisible((visible) => {
      iframeRef.current?.contentWindow?.postMessage(
        { collapsed: visible, type: "CHEATCODE_SET_SIDEBAR_COLLAPSED" },
        "*",
      );
      return !visible;
    });
  };

  if (!sandboxReady) {
    return <IdePlaceholder label="Files starting" />;
  }
  if (ideQuery.isPending) {
    return <IdePlaceholder label="Opening Files" />;
  }
  if (ideQuery.isError) {
    return (
      <div className="grid h-full min-h-[420px] place-items-center bg-[#fafafa]">
        <div className="space-y-3 text-center">
          <div className="font-semibold text-[13px] text-red-700">Files unavailable</div>
          <p className="max-w-[360px] text-[12px] text-thread-text-secondary">
            {ideQuery.error.message}
          </p>
          <button
            className="rounded-full border border-thread-border px-3 py-2 text-[12px] text-thread-text-secondary hover:bg-thread-hover hover:text-thread-text-primary"
            onClick={() => {
              void ideQuery.refetch();
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const iframeUrl = codeServerIframeUrl(ideQuery.data.url, previewReloadToken);
  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-[20.5px] bg-white">
      <BudTooltip
        className="absolute top-1 left-1.5 z-20"
        label="Toggle file explorer"
        side="right"
      >
        <button
          aria-label="Toggle file explorer"
          className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-full p-1.5 text-[#5f5f5f] transition-colors duration-150 hover:bg-white hover:text-[#1b1b1b]"
          onClick={toggleSidebar}
          type="button"
        >
          <PanelLeftOpen
            aria-hidden="true"
            className={cn("h-3.5 w-3.5 transition-transform", !sidebarVisible && "scale-x-[-1]")}
          />
        </button>
      </BudTooltip>
      <iframe
        allow="clipboard-read; clipboard-write; cross-origin-isolated"
        className="h-full w-full rounded-[20.5px] border-0 bg-white opacity-100 transition-opacity duration-300 ease-out"
        key={iframeUrl}
        ref={iframeRef}
        src={iframeUrl}
        title="Code Server"
      />
    </div>
  );
}

function IdePlaceholder({ label }: { label: string }) {
  return (
    <div className="grid h-full min-h-[420px] place-items-center bg-[#fafafa]">
      <div className="text-center">
        <div className="mx-auto mb-4 h-2 w-2 rounded-full bg-thread-status-warning" />
        <div className="text-[12px] text-thread-text-muted">{label}</div>
      </div>
    </div>
  );
}
