"use client";

import type { IntegrationName } from "@cheatcode/types";
import type { ProjectSummary } from "@cheatcode/types/api";
import { useAuth } from "@clerk/nextjs";
import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RunStatus } from "@/components/chat/status-pill";
import type { ComposerMenuItem } from "@/components/composer/composer-popover";
import {
  type ComposerMenuController,
  useComposerMenu,
} from "@/components/composer/use-composer-menu";
import {
  type ProjectFileUploads,
  useProjectFileUploads,
} from "@/components/composer/use-project-file-uploads";
import { useAppStore } from "@/lib/store/app-store";

type ComposerControlMenu = "model";

export interface PromptComposerProps {
  onChange: (value: string) => void;
  onStop: () => void;
  onSubmit: (
    value: string,
    project: ProjectSummary | null,
    selection: { selectedSkill: string | null; selectedTool: IntegrationName | null },
  ) => boolean;
  project: ProjectSummary | null;
  resolvedModelId: null | string;
  status: RunStatus;
  threadId: string;
  value: string;
}

interface PromptComposerState {
  canSubmit: boolean;
  computerOpen: boolean;
  isMenuOpen: boolean;
  isRunning: boolean;
  menuAriaLabel: string;
  menuItems: readonly ComposerMenuItem[];
  openControlMenu: ComposerControlMenu | null;
  resolvedModelId: null | string;
  selectedProject: ProjectSummary | null;
  selectedSkill: string | null;
  selectedTool: IntegrationName | null;
  value: string;
}

interface PromptComposerActions {
  clearSkill: () => void;
  clearTool: () => void;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  selectProject: (project: ProjectSummary | null) => void;
  setModelMenuOpen: (isOpen: boolean) => void;
}

export interface PromptComposerController {
  actions: PromptComposerActions;
  attachments: ProjectFileUploads;
  meta: { textareaRef: RefObject<HTMLTextAreaElement | null> };
  state: PromptComposerState;
  triggers: ComposerMenuController["triggers"];
}

export function usePromptComposerController(props: PromptComposerProps): PromptComposerController {
  const { getToken } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const publisher = usePublishedValue(props.value, props.onChange);
  const isRunning = props.status === "streaming" || props.status === "submitted";
  const computerOpen = useAppStore((state) => state.previewPanelOpen);
  const projectSelection = useProjectSelection(props.project);
  const menu = useComposerMenu({
    getToken,
    onChange: publisher.publishValue,
    onSelectSkill: projectSelection.setSelectedSkill,
    onSelectTool: projectSelection.setSelectedTool,
    projectId: projectSelection.selectedProject?.id ?? null,
    textareaRef,
    value: props.value,
  });
  const attachments = useProjectFileUploads({
    getToken,
    latestValueRef: publisher.latestValueRef,
    onChange: publisher.publishValue,
    onProjectCreated: projectSelection.selectProject,
    project: projectSelection.selectedProject,
    value: props.value,
  });
  return usePromptComposerAssembly({
    attachments,
    computerOpen,
    isRunning,
    menu,
    projectSelection,
    props,
    textareaRef,
  });
}

function usePublishedValue(value: string, onChange: (value: string) => void) {
  const latestValueRef = useRef(value);
  useLayoutEffect(() => {
    latestValueRef.current = value;
  }, [value]);
  const publishValue = useCallback(
    (nextValue: string) => {
      latestValueRef.current = nextValue;
      onChange(nextValue);
    },
    [onChange],
  );
  return { latestValueRef, publishValue };
}

function useProjectSelection(project: ProjectSummary | null) {
  const [override, setOverride] = useState<{
    contextProjectId: ProjectSummary["id"] | null;
    project: ProjectSummary | null;
  } | null>(null);
  const contextProjectId = project?.id ?? null;
  const selectedProject =
    override?.contextProjectId === contextProjectId ? override.project : project;
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<IntegrationName | null>(null);
  const selectProject = (nextProject: ProjectSummary | null) =>
    setOverride({ contextProjectId, project: nextProject });
  return {
    selectedProject,
    selectedSkill,
    selectedTool,
    selectProject,
    setSelectedSkill: (skill: string | null) => {
      setSelectedSkill(skill);
      if (skill) setSelectedTool(null);
    },
    setSelectedTool: (tool: IntegrationName | null) => {
      setSelectedTool(tool);
      if (tool) setSelectedSkill(null);
    },
  };
}

type PromptComposerAssemblyOptions = {
  attachments: ProjectFileUploads;
  computerOpen: boolean;
  isRunning: boolean;
  menu: ComposerMenuController;
  projectSelection: ReturnType<typeof useProjectSelection>;
  props: PromptComposerProps;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

function usePromptComposerAssembly(options: PromptComposerAssemblyOptions) {
  const [openControlMenu, setOpenControlMenu] = useState<ComposerControlMenu | null>(null);
  const canSubmit =
    options.props.value.trim().length > 0 && !options.isRunning && !options.attachments.isUploading;
  const submission = createComposerSubmission({
    canSubmit,
    isRunning: options.isRunning,
    menu: options.menu,
    onStop: options.props.onStop,
    onSubmit: options.props.onSubmit,
    project: options.projectSelection.selectedProject,
    selection: options.projectSelection,
    value: options.props.value,
  });
  return {
    actions: {
      clearSkill: () => options.projectSelection.setSelectedSkill(null),
      clearTool: () => options.projectSelection.setSelectedTool(null),
      handleKeyDown: submission.handleKeyDown,
      handleSubmit: submission.handleSubmit,
      selectProject: options.projectSelection.selectProject,
      setModelMenuOpen: (isOpen: boolean) => setOpenControlMenu(isOpen ? "model" : null),
    },
    attachments: options.attachments,
    meta: { textareaRef: options.textareaRef },
    state: createPromptComposerState(options, canSubmit, openControlMenu),
    triggers: options.menu.triggers,
  } satisfies PromptComposerController;
}

function createPromptComposerState(
  options: PromptComposerAssemblyOptions,
  canSubmit: boolean,
  openControlMenu: ComposerControlMenu | null,
): PromptComposerState {
  return {
    canSubmit,
    computerOpen: options.computerOpen,
    isMenuOpen: options.menu.isOpen,
    isRunning: options.isRunning,
    menuAriaLabel: options.menu.ariaLabel,
    menuItems: options.menu.items,
    openControlMenu,
    resolvedModelId: options.props.resolvedModelId,
    selectedProject: options.projectSelection.selectedProject,
    selectedSkill: options.projectSelection.selectedSkill,
    selectedTool: options.projectSelection.selectedTool,
    value: options.props.value,
  };
}

type ComposerSubmissionOptions = {
  canSubmit: boolean;
  isRunning: boolean;
  menu: ComposerMenuController;
  selection: ReturnType<typeof useProjectSelection>;
  onStop: () => void;
  onSubmit: PromptComposerProps["onSubmit"];
  project: ProjectSummary | null;
  value: string;
};

function createComposerSubmission({
  canSubmit,
  isRunning,
  menu,
  onStop,
  onSubmit,
  project,
  selection,
  value,
}: ComposerSubmissionOptions) {
  function submitComposerValue() {
    const wasAccepted = onSubmit(value.trim(), project, {
      selectedSkill: selection.selectedSkill,
      selectedTool: selection.selectedTool,
    });
    if (wasAccepted) {
      selection.setSelectedSkill(null);
      selection.setSelectedTool(null);
    }
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRunning) {
      onStop();
    } else if (canSubmit) {
      submitComposerValue();
    }
  }
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (menu.handleKeyDown(event)) {
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (canSubmit) {
        submitComposerValue();
      }
    }
    if (event.key === "Escape" && isRunning) {
      event.preventDefault();
      onStop();
    }
  }
  return { handleKeyDown, handleSubmit };
}
