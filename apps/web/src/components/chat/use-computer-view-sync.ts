import {
  CHEATCODE_DATA_SCHEMAS,
  type CheatcodeUIMessage,
  reconstructedTranscriptUIMessage,
  type SandboxState,
} from "@cheatcode/types";
import type { ProjectMode, ProjectSummary } from "@cheatcode/types/api";
import type { ChatStatus } from "ai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { type ComputerTab, useAppStore } from "@/lib/store/app-store";

type SandboxStatusData = Extract<
  CheatcodeUIMessage["parts"][number],
  { type: "data-sandbox-status" }
>["data"];

type AppPreviewStatusData = Extract<
  CheatcodeUIMessage["parts"][number],
  { type: "data-app-preview-status" }
>["data"];

export interface SandboxStatusActions {
  setActiveComputerTab: (tab: ComputerTab) => void;
  setAppPreviewStatus: (status: AppPreviewStatusData["status"] | "idle") => void;
  setPreviewPanelOpen: (open: boolean) => void;
  setSandboxStatus: (status: SandboxState) => void;
}

interface ComputerViewActions extends SandboxStatusActions {
  requestPreviewReload: () => void;
}

interface SandboxComputerSyncInput extends SandboxStatusActions {
  chatStatus: ChatStatus;
  messages: readonly CheatcodeUIMessage[];
  project: ProjectSummary | null;
  resetConsole: () => void;
  resetPreviewNavigation: () => void;
  setExpoUrl: (url: null | string) => void;
  setPreviewPanelOpen: (open: boolean) => void;
  setPreviewUrl: (url: null | string) => void;
  viewApplier: ComputerViewApplier;
}

export type ComputerViewCommand =
  | { kind: "preview-status"; status: AppPreviewStatusData["status"] }
  | { kind: "status"; status: SandboxStatusData["status"] }
  | { artifactId: string; kind: "open-files" }
  | { kind: "open-browser-preview"; shouldReload: boolean; toolCallId: string };

export interface ComputerViewApplier {
  apply: (command: ComputerViewCommand) => void;
  reset: () => void;
}

interface ComputerViewApplierInput extends ComputerViewActions {
  projectId: string | null;
  projectMode: ProjectMode | null;
  threadId: string;
}

interface ComputerViewCommandState {
  appliedSurfaceKeys: Set<string>;
  scopeKey: string;
}

interface HydratedComputerViewCommands {
  preview: ComputerViewCommand | null;
  status: ComputerViewCommand | null;
  surface: ComputerViewCommand | null;
}

export function useComputerViewApplier(input: ComputerViewApplierInput): ComputerViewApplier {
  const scopeKey = `${input.threadId}:${input.projectId ?? ""}:${input.projectMode ?? ""}`;
  const stateRef = useRef<ComputerViewCommandState>(createComputerViewCommandState(scopeKey));
  if (stateRef.current.scopeKey !== scopeKey) {
    stateRef.current = createComputerViewCommandState(scopeKey);
  }
  const actions = useMemo(
    () => ({
      requestPreviewReload: input.requestPreviewReload,
      setActiveComputerTab: input.setActiveComputerTab,
      setAppPreviewStatus: input.setAppPreviewStatus,
      setPreviewPanelOpen: input.setPreviewPanelOpen,
      setSandboxStatus: input.setSandboxStatus,
    }),
    [
      input.requestPreviewReload,
      input.setActiveComputerTab,
      input.setAppPreviewStatus,
      input.setPreviewPanelOpen,
      input.setSandboxStatus,
    ],
  );
  const apply = useCallback(
    (command: ComputerViewCommand) =>
      applyComputerViewCommand(
        command,
        input.threadId,
        input.projectMode,
        stateRef.current,
        actions,
      ),
    [actions, input.projectMode, input.threadId],
  );
  const reset = useCallback(() => {
    stateRef.current = createComputerViewCommandState(scopeKey);
  }, [scopeKey]);
  return useMemo(() => ({ apply, reset }), [apply, reset]);
}

export function useSandboxComputerSync(input: SandboxComputerSyncInput): void {
  const commands = useMemo(
    () => hydratedComputerViewCommands(input.messages, input.project?.mode ?? null),
    [input.messages, input.project?.mode],
  );
  const status = commands.status?.kind === "status" ? commands.status.status : null;
  const defaultedProjectFilesRef = useRef<string | null>(null);
  const previousStatusRef = useRef(input.chatStatus);
  const actions = useMemo(
    () => ({
      setActiveComputerTab: input.setActiveComputerTab,
      setAppPreviewStatus: input.setAppPreviewStatus,
      setPreviewPanelOpen: input.setPreviewPanelOpen,
      setSandboxStatus: input.setSandboxStatus,
    }),
    [
      input.setActiveComputerTab,
      input.setAppPreviewStatus,
      input.setPreviewPanelOpen,
      input.setSandboxStatus,
    ],
  );

  useResetSandboxComputer(input);
  useHydratedComputerViewCommand(commands.status, input.viewApplier);
  useHydratedComputerViewCommand(commands.preview, input.viewApplier);
  useProjectFilesDefault(input.project, status, actions, defaultedProjectFilesRef);
  useHydratedComputerViewCommand(commands.surface, input.viewApplier);
  useCompletionPreview(input.chatStatus, previousStatusRef);
}

export function computerViewEffect(part: unknown): ComputerViewCommand | null {
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
  if (part["type"] === "data-artifact") {
    const parsed = CHEATCODE_DATA_SCHEMAS.artifact.safeParse(part["data"]);
    return parsed.success ? { artifactId: parsed.data.outputId, kind: "open-files" } : null;
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

function useResetSandboxComputer(input: SandboxComputerSyncInput): void {
  useEffect(() => {
    input.viewApplier.reset();
    input.resetConsole();
    input.resetPreviewNavigation();
    input.setAppPreviewStatus("idle");
    input.setPreviewUrl(null);
    input.setExpoUrl(null);
    input.setPreviewPanelOpen(false);
    input.setActiveComputerTab("files");
    input.setSandboxStatus("cold");
  }, [
    input.resetConsole,
    input.resetPreviewNavigation,
    input.setActiveComputerTab,
    input.setExpoUrl,
    input.setAppPreviewStatus,
    input.setPreviewPanelOpen,
    input.setPreviewUrl,
    input.setSandboxStatus,
    input.viewApplier,
  ]);
}

function useHydratedComputerViewCommand(
  command: ComputerViewCommand | null,
  applier: ComputerViewApplier,
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
    actions.setActiveComputerTab("files");
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

function hydratedComputerViewCommands(
  messages: readonly CheatcodeUIMessage[],
  projectMode: ProjectMode | null,
): HydratedComputerViewCommands {
  const commands: HydratedComputerViewCommands = { preview: null, status: null, surface: null };
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
      recordHydratedComputerViewCommand(commands, computerViewEffect(part), projectMode);
    }
  }
  return commands;
}

function recordHydratedComputerViewCommand(
  commands: HydratedComputerViewCommands,
  command: ComputerViewCommand | null,
  projectMode: ProjectMode | null,
): void {
  if (!shouldApplyComputerViewCommand(command, projectMode)) {
    return;
  }
  if (command?.kind === "status") {
    commands.status = command;
  } else if (command?.kind === "preview-status") {
    commands.preview = command;
  } else if (command?.kind === "open-browser-preview") {
    commands.surface = command;
  } else if (command?.kind === "open-files") {
    commands.surface = command;
  }
}

function applyComputerViewCommand(
  command: ComputerViewCommand,
  threadId: string,
  projectMode: ProjectMode | null,
  state: ComputerViewCommandState,
  actions: ComputerViewActions,
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
  if (!shouldApplyComputerViewCommand(command, projectMode)) {
    return;
  }
  const surfaceId = command.kind === "open-files" ? command.artifactId : command.toolCallId;
  const onceKey = `${threadId}:${command.kind}:${surfaceId}`;
  if (state.appliedSurfaceKeys.has(onceKey)) {
    return;
  }
  state.appliedSurfaceKeys.add(onceKey);
  if (command.kind === "open-files") {
    actions.setActiveComputerTab("files");
    actions.setPreviewPanelOpen(true);
    return;
  }
  if (command.shouldReload) {
    actions.requestPreviewReload();
  }
  actions.setActiveComputerTab("browser");
  actions.setPreviewPanelOpen(true);
}

function shouldApplyComputerViewCommand(
  command: ComputerViewCommand | null,
  projectMode: ProjectMode | null,
): boolean {
  return command !== null && (command.kind !== "open-browser-preview" || projectMode !== "general");
}

function createComputerViewCommandState(scopeKey: string): ComputerViewCommandState {
  return { appliedSurfaceKeys: new Set<string>(), scopeKey };
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
