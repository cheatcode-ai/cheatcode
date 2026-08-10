import {
  CHEATCODE_DATA_SCHEMAS,
  type CheatcodeUIMessage,
  reconstructedTranscriptUIMessage,
  type SandboxState,
} from "@cheatcode/types";
import type { ProjectSummary } from "@cheatcode/types/api";
import type { ChatStatus } from "ai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { type PreviewTab, useAppStore } from "@/lib/store/app-store";

type SandboxStatusData = Extract<
  CheatcodeUIMessage["parts"][number],
  { type: "data-sandbox-status" }
>["data"];

type AppPreviewStatusData = Extract<
  CheatcodeUIMessage["parts"][number],
  { type: "data-app-preview-status" }
>["data"];

export interface SandboxStatusActions {
  setActivePreviewTab: (tab: PreviewTab) => void;
  setAppPreviewStatus: (status: AppPreviewStatusData["status"] | "idle") => void;
  setPreviewPanelOpen: (open: boolean) => void;
  setSandboxStatus: (status: SandboxState) => void;
}

interface WorkspaceSurfaceActions extends SandboxStatusActions {
  bumpPreviewReloadToken: () => void;
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
  surfaceApplier: WorkspaceSurfaceApplier;
}

export type SurfaceCommand =
  | { kind: "preview-status"; status: AppPreviewStatusData["status"] }
  | { kind: "status"; status: SandboxStatusData["status"] }
  | { kind: "open-browser-preview"; shouldReload: boolean; toolCallId: string };

export interface WorkspaceSurfaceApplier {
  apply: (command: SurfaceCommand) => void;
  reset: () => void;
}

interface WorkspaceSurfaceApplierInput extends WorkspaceSurfaceActions {
  projectId: string | null;
  threadId: string;
}

interface SurfaceCommandState {
  openedBrowserToolKeys: Set<string>;
  scopeKey: string;
}

interface HydratedSurfaceCommands {
  browser: SurfaceCommand | null;
  preview: SurfaceCommand | null;
  status: SurfaceCommand | null;
}

export function useWorkspaceSurfaceApplier(
  input: WorkspaceSurfaceApplierInput,
): WorkspaceSurfaceApplier {
  const scopeKey = `${input.threadId}:${input.projectId ?? ""}`;
  const stateRef = useRef<SurfaceCommandState>(createSurfaceCommandState(scopeKey));
  if (stateRef.current.scopeKey !== scopeKey) {
    stateRef.current = createSurfaceCommandState(scopeKey);
  }
  const actions = useMemo(
    () => ({
      bumpPreviewReloadToken: input.bumpPreviewReloadToken,
      setActivePreviewTab: input.setActivePreviewTab,
      setAppPreviewStatus: input.setAppPreviewStatus,
      setPreviewPanelOpen: input.setPreviewPanelOpen,
      setSandboxStatus: input.setSandboxStatus,
    }),
    [
      input.bumpPreviewReloadToken,
      input.setActivePreviewTab,
      input.setAppPreviewStatus,
      input.setPreviewPanelOpen,
      input.setSandboxStatus,
    ],
  );
  const apply = useCallback(
    (command: SurfaceCommand) =>
      applyWorkspaceSurfaceCommand(command, input.threadId, stateRef.current, actions),
    [actions, input.threadId],
  );
  const reset = useCallback(() => {
    stateRef.current = createSurfaceCommandState(scopeKey);
  }, [scopeKey]);
  return useMemo(() => ({ apply, reset }), [apply, reset]);
}

export function useSandboxSurfaceSync(input: SandboxSurfaceSyncInput): void {
  const commands = useMemo(() => hydratedSurfaceCommands(input.messages), [input.messages]);
  const status = commands.status?.kind === "status" ? commands.status.status : null;
  const defaultedProjectFilesRef = useRef<string | null>(null);
  const previousStatusRef = useRef(input.chatStatus);
  const actions = useMemo(
    () => ({
      setActivePreviewTab: input.setActivePreviewTab,
      setAppPreviewStatus: input.setAppPreviewStatus,
      setPreviewPanelOpen: input.setPreviewPanelOpen,
      setSandboxStatus: input.setSandboxStatus,
    }),
    [
      input.setActivePreviewTab,
      input.setAppPreviewStatus,
      input.setPreviewPanelOpen,
      input.setSandboxStatus,
    ],
  );

  useResetSandboxSurface(input);
  useHydratedSurfaceCommand(commands.status, input.surfaceApplier);
  useHydratedSurfaceCommand(commands.preview, input.surfaceApplier);
  useProjectFilesDefault(input.project, status, actions, defaultedProjectFilesRef);
  useHydratedSurfaceCommand(commands.browser, input.surfaceApplier);
  useCompletionPreview(input.chatStatus, previousStatusRef);
}

export function workspaceSurfaceEffect(part: unknown): SurfaceCommand | null {
  if (!isRecord(part)) {
    return null;
  }
  if (part["type"] === "data-sandbox-status") {
    const parsed = CHEATCODE_DATA_SCHEMAS["sandbox-status"].safeParse(part["data"]);
    return parsed.success ? { kind: "status", status: parsed.data.status } : null;
  }
  if (part["type"] === "data-app-preview-status") {
    const parsed = CHEATCODE_DATA_SCHEMAS["app-preview-status"].safeParse(part["data"]);
    return parsed.success ? { kind: "preview-status", status: parsed.data.status } : null;
  }
  if (part["type"] !== "data-tool") {
    return null;
  }
  const parsed = CHEATCODE_DATA_SCHEMAS.tool.safeParse(part["data"]);
  return parsed.success && isBrowserToolName(parsed.data.toolName)
    ? {
        kind: "open-browser-preview",
        shouldReload: parsed.data.toolName === "browser_open",
        toolCallId: parsed.data.toolCallId,
      }
    : null;
}

function useResetSandboxSurface(input: SandboxSurfaceSyncInput): void {
  useEffect(() => {
    input.surfaceApplier.reset();
    input.resetConsole();
    input.resetPreviewNavigation();
    input.setAppPreviewStatus("idle");
    input.setPreviewUrl(null);
    input.setExpoUrl(null);
    input.setPreviewPanelOpen(false);
    input.setSandboxStatus("cold");
  }, [
    input.resetConsole,
    input.resetPreviewNavigation,
    input.setExpoUrl,
    input.setAppPreviewStatus,
    input.setPreviewPanelOpen,
    input.setPreviewUrl,
    input.setSandboxStatus,
    input.surfaceApplier,
  ]);
}

function useHydratedSurfaceCommand(
  command: SurfaceCommand | null,
  applier: WorkspaceSurfaceApplier,
): void {
  useEffect(() => {
    if (command) {
      applier.apply(command);
    }
  }, [applier, command]);
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

function hydratedSurfaceCommands(messages: readonly CheatcodeUIMessage[]): HydratedSurfaceCommands {
  const commands: HydratedSurfaceCommands = { browser: null, preview: null, status: null };
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message) {
      continue;
    }
    const parts = reconstructedTranscriptUIMessage(message).parts;
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex];
      if (!part) {
        continue;
      }
      recordHydratedSurfaceCommand(commands, workspaceSurfaceEffect(part));
    }
  }
  return commands;
}

function recordHydratedSurfaceCommand(
  commands: HydratedSurfaceCommands,
  command: SurfaceCommand | null,
): void {
  if (command?.kind === "status") {
    commands.status = command;
  } else if (command?.kind === "preview-status") {
    commands.preview = command;
  } else if (command?.kind === "open-browser-preview") {
    commands.browser = command;
  }
}

function applyWorkspaceSurfaceCommand(
  command: SurfaceCommand,
  threadId: string,
  state: SurfaceCommandState,
  actions: WorkspaceSurfaceActions,
): void {
  if (command.kind === "status") {
    if (useAppStore.getState().sandboxStatus !== command.status) {
      actions.setSandboxStatus(command.status);
    }
    return;
  }
  if (command.kind === "preview-status") {
    if (useAppStore.getState().appPreviewStatus !== command.status) {
      actions.setAppPreviewStatus(command.status);
    }
    return;
  }
  const onceKey = `${threadId}:${command.toolCallId}`;
  if (state.openedBrowserToolKeys.has(onceKey)) {
    return;
  }
  state.openedBrowserToolKeys.add(onceKey);
  if (command.shouldReload) {
    actions.bumpPreviewReloadToken();
  }
  actions.setActivePreviewTab("app");
  actions.setPreviewPanelOpen(true);
}

function createSurfaceCommandState(scopeKey: string): SurfaceCommandState {
  return { openedBrowserToolKeys: new Set<string>(), scopeKey };
}

function isBrowserToolName(toolName: string): boolean {
  return (
    toolName === "browser_act" ||
    toolName === "browser_extract" ||
    toolName === "browser_observe" ||
    toolName === "browser_open" ||
    toolName === "browser_screenshot"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
