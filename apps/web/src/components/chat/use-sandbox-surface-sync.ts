import {
  type CheatcodeUIMessage,
  type ProjectSummary,
  reconstructedTranscriptUIMessage,
  type SandboxState,
} from "@cheatcode/types";
import type { ChatStatus } from "ai";
import { useEffect, useMemo, useRef } from "react";
import { type PreviewTab, useAppStore } from "@/lib/store/app-store";

type SandboxStatusData = Extract<
  CheatcodeUIMessage["parts"][number],
  { type: "data-sandbox-status" }
>["data"];

export interface SandboxStatusActions {
  setActivePreviewTab: (tab: PreviewTab) => void;
  setPreviewPanelOpen: (open: boolean) => void;
  setSandboxStatus: (status: SandboxState) => void;
}

interface SandboxSurfaceSyncInput extends SandboxStatusActions {
  chatStatus: ChatStatus;
  messages: readonly CheatcodeUIMessage[];
  project: ProjectSummary | null;
  resetConsole: () => void;
  resetPreviewNavigation: () => void;
  setExpoUrl: (url: null | string) => void;
  setPreviewPanelOpen: (open: boolean) => void;
  setPreviewUrl: (url: null | string) => void;
}

export function useSandboxSurfaceSync(input: SandboxSurfaceSyncInput): void {
  const latestStatus = latestSandboxStatusFromMessages(input.messages);
  const browserActivityKey = latestBrowserActivityKeyFromMessages(input.messages);
  const status = latestStatus?.status ?? null;
  const appliedSnapshotRef = useRef<string | null | undefined>(undefined);
  const openedBrowserActivityRef = useRef<string | null>(null);
  const defaultedProjectFilesRef = useRef<string | null>(null);
  const previousStatusRef = useRef(input.chatStatus);
  const actions = useMemo(
    () => ({
      setActivePreviewTab: input.setActivePreviewTab,
      setPreviewPanelOpen: input.setPreviewPanelOpen,
      setSandboxStatus: input.setSandboxStatus,
    }),
    [input.setActivePreviewTab, input.setPreviewPanelOpen, input.setSandboxStatus],
  );

  useResetSandboxSurface(input);
  useMessageStatusSync(status, actions, appliedSnapshotRef);
  useProjectFilesDefault(input.project, status, actions, defaultedProjectFilesRef);
  useBrowserActivityDefault(browserActivityKey, actions, openedBrowserActivityRef);
  useCompletionPreview(input.chatStatus, previousStatusRef);
}

export function applySandboxStatus(data: SandboxStatusData, actions: SandboxStatusActions): void {
  actions.setSandboxStatus(data.status);
}

export function isBrowserToolName(toolName: string): boolean {
  return (
    toolName === "browser_act" ||
    toolName === "browser_extract" ||
    toolName === "browser_observe" ||
    toolName === "browser_open" ||
    toolName === "browser_screenshot"
  );
}

function useResetSandboxSurface(input: SandboxSurfaceSyncInput): void {
  useEffect(() => {
    input.resetConsole();
    input.resetPreviewNavigation();
    input.setPreviewUrl(null);
    input.setExpoUrl(null);
    input.setPreviewPanelOpen(false);
  }, [
    input.resetConsole,
    input.resetPreviewNavigation,
    input.setExpoUrl,
    input.setPreviewPanelOpen,
    input.setPreviewUrl,
  ]);
}

function useMessageStatusSync(
  status: null | SandboxStatusData["status"],
  actions: SandboxStatusActions,
  appliedSnapshotRef: { current: string | null | undefined },
): void {
  useEffect(() => {
    if (appliedSnapshotRef.current === status) {
      return;
    }
    appliedSnapshotRef.current = status;
    if (!status) {
      actions.setSandboxStatus("cold");
      return;
    }
    applySandboxStatus({ v: 1, status }, actions);
  }, [actions, appliedSnapshotRef, status]);
}

function useProjectFilesDefault(
  project: ProjectSummary | null,
  status: null | SandboxStatusData["status"],
  actions: SandboxStatusActions,
  defaultedProjectFilesRef: { current: string | null },
): void {
  useEffect(() => {
    if (!project || status || defaultedProjectFilesRef.current === project.id) {
      return;
    }
    defaultedProjectFilesRef.current = project.id;
    actions.setActivePreviewTab("files");
  }, [actions, defaultedProjectFilesRef, project, status]);
}

function useBrowserActivityDefault(
  activityKey: string | null,
  actions: SandboxStatusActions,
  openedBrowserActivityRef: { current: string | null },
): void {
  useEffect(() => {
    if (!activityKey || openedBrowserActivityRef.current === activityKey) {
      return;
    }
    openedBrowserActivityRef.current = activityKey;
    actions.setActivePreviewTab("app");
    actions.setPreviewPanelOpen(true);
  }, [actions, activityKey, openedBrowserActivityRef]);
}

function useCompletionPreview(
  status: ChatStatus,
  previousStatusRef: { current: ChatStatus },
): void {
  useEffect(() => {
    const wasRunning =
      previousStatusRef.current === "streaming" || previousStatusRef.current === "submitted";
    previousStatusRef.current = status;
    if (!wasRunning || status !== "ready") {
      return;
    }
    const store = useAppStore.getState();
    if (store.sandboxStatus !== "cold") {
      store.setPreviewPanelOpen(true);
    }
  }, [previousStatusRef, status]);
}

function latestSandboxStatusFromMessages(
  messages: readonly CheatcodeUIMessage[],
): SandboxStatusData | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message) {
      continue;
    }
    const parts = reconstructedTranscriptUIMessage(message).parts;
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part?.type === "data-sandbox-status") {
        return part.data;
      }
    }
  }
  return null;
}

function latestBrowserActivityKeyFromMessages(
  messages: readonly CheatcodeUIMessage[],
): string | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message) {
      continue;
    }
    const parts = reconstructedTranscriptUIMessage(message).parts;
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part?.type === "data-tool" && isBrowserToolName(part.data.toolName)) {
        return `${message.id}:${part.data.toolCallId}`;
      }
    }
  }
  return null;
}
