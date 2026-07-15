"use client";

import type { ProjectSummary } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RunStatus } from "@/components/chat/status-pill";
import {
  type ComposerStatusTone,
  type PromptAttachments,
  usePromptAttachments,
} from "@/components/chat/use-prompt-attachments";
import { useVoiceInput, type VoiceInputState } from "@/components/chat/use-voice-input";
import { composePromptWithComposerContext } from "@/components/composer/composer-context-chips";
import type { ComposerMenuItem } from "@/components/composer/composer-popover";
import { useMentionFileItems } from "@/components/composer/mention-file-source";
import { slashSkillItems } from "@/components/composer/slash-skill-source";
import {
  type ComposerTriggers,
  type TriggerDetector,
  useComposerTriggers,
} from "@/components/composer/use-composer-triggers";
import { listUserSkills, USER_SKILLS_QUERY } from "@/lib/api/skills";
import { detectMentionToken, detectSlashToken } from "@/lib/input/caret-tokens";
import { useAppStore } from "@/lib/store/app-store";
import { emitComposerEvent } from "@/lib/telemetry/user-events";

const SLASH_DETECTOR: TriggerDetector = { detect: detectSlashToken, kind: "slash" };
const MENTION_DETECTOR: TriggerDetector = { detect: detectMentionToken, kind: "mention" };
type ComposerControlMenu = "model";

export interface PromptComposerProps {
  onChange: (value: string) => void;
  onStop: () => void;
  onSubmit: (value: string, project: ProjectSummary | null) => boolean;
  project: ProjectSummary | null;
  status: RunStatus;
  threadId: string;
  value: string;
}

interface PromptComposerState {
  canSubmit: boolean;
  composerStatus: string | null;
  composerStatusTone: ComposerStatusTone;
  computerOpen: boolean;
  isMenuOpen: boolean;
  isRunning: boolean;
  menuAriaLabel: string;
  menuItems: readonly ComposerMenuItem[];
  openControlMenu: ComposerControlMenu | null;
  selectedProject: ProjectSummary | null;
  selectedSkill: string | null;
  value: string;
}

interface PromptComposerActions {
  clearSkill: () => void;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  selectProject: (project: ProjectSummary | null) => void;
  setModelMenuOpen: (isOpen: boolean) => void;
}

export interface PromptComposerController {
  actions: PromptComposerActions;
  attachments: PromptAttachments;
  meta: { textareaRef: RefObject<HTMLTextAreaElement | null> };
  state: PromptComposerState;
  triggers: ComposerTriggers;
  voiceInput: VoiceInputState;
}

export function usePromptComposerController(props: PromptComposerProps): PromptComposerController {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const publisher = usePublishedValue(props.value, props.onChange);
  const isRunning = props.status === "streaming" || props.status === "submitted";
  const sandboxReady = useAppStore((state) => state.sandboxStatus === "ready");
  const computerOpen = useAppStore((state) => state.previewPanelOpen);
  const menu = usePromptComposerMenu({
    onChange: publisher.publishValue,
    sandboxReady,
    textareaRef,
    threadId: props.threadId,
    value: props.value,
  });
  const projectSelection = useProjectSelection(props.project);
  const attachments = usePromptAttachments({
    latestValueRef: publisher.latestValueRef,
    onChange: publisher.publishValue,
  });
  const voiceInput = useVoiceInput({
    currentValue: props.value,
    disabled: isRunning,
    onChange: publisher.publishValue,
  });
  return usePromptComposerAssembly({
    attachments,
    computerOpen,
    isRunning,
    menu,
    projectSelection,
    props,
    textareaRef,
    voiceInput,
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

function usePromptComposerMenu({
  onChange,
  sandboxReady,
  textareaRef,
  threadId,
  value,
}: {
  onChange: (value: string) => void;
  sandboxReady: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  threadId: string;
  value: string;
}) {
  const { getToken } = useAuth();
  const { data: userSkills } = useQuery({
    queryFn: () => listUserSkills(getToken),
    queryKey: USER_SKILLS_QUERY,
    staleTime: 60_000,
  });
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const sources = useMemo(
    () => (sandboxReady ? [SLASH_DETECTOR, MENTION_DETECTOR] : [SLASH_DETECTOR]),
    [sandboxReady],
  );
  const triggers = useComposerTriggers({
    onChange,
    onInsert: (kind, item) => {
      if (kind === "slash") {
        setSelectedSkill(item.id);
      }
      emitComposerEvent(
        getToken,
        kind === "mention" ? "composer_mention_inserted" : "composer_slash_inserted",
      );
    },
    sources,
    textareaRef,
    value,
  });
  const mentionItems = useMentionFileItems({
    enabled: sandboxReady && triggers.kind === "mention",
    query: triggers.query,
    threadId,
  });
  const menuItems =
    triggers.kind === "mention" ? mentionItems : slashSkillItems(triggers.query, userSkills ?? []);
  return { menuItems, selectedSkill, setSelectedSkill, triggers };
}

function useProjectSelection(project: ProjectSummary | null) {
  const [override, setOverride] = useState<{
    contextProjectId: ProjectSummary["id"] | null;
    project: ProjectSummary | null;
  } | null>(null);
  const contextProjectId = project?.id ?? null;
  const selectedProject =
    override?.contextProjectId === contextProjectId ? override.project : project;
  const selectProject = (nextProject: ProjectSummary | null) =>
    setOverride({ contextProjectId, project: nextProject });
  return { selectProject, selectedProject };
}

type PromptComposerAssemblyOptions = {
  attachments: PromptAttachments;
  computerOpen: boolean;
  isRunning: boolean;
  menu: ReturnType<typeof usePromptComposerMenu>;
  projectSelection: ReturnType<typeof useProjectSelection>;
  props: PromptComposerProps;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  voiceInput: VoiceInputState;
};

function usePromptComposerAssembly(options: PromptComposerAssemblyOptions) {
  const [openControlMenu, setOpenControlMenu] = useState<ComposerControlMenu | null>(null);
  const canSubmit = options.props.value.trim().length > 0 && !options.isRunning;
  const submission = createComposerSubmission({
    canSubmit,
    isRunning: options.isRunning,
    menu: options.menu,
    onStop: options.props.onStop,
    onSubmit: options.props.onSubmit,
    project: options.projectSelection.selectedProject,
    value: options.props.value,
  });
  return {
    actions: {
      clearSkill: () => options.menu.setSelectedSkill(null),
      handleKeyDown: submission.handleKeyDown,
      handleSubmit: submission.handleSubmit,
      selectProject: options.projectSelection.selectProject,
      setModelMenuOpen: (isOpen: boolean) => setOpenControlMenu(isOpen ? "model" : null),
    },
    attachments: options.attachments,
    meta: { textareaRef: options.textareaRef },
    state: createPromptComposerState(options, canSubmit, openControlMenu),
    triggers: options.menu.triggers,
    voiceInput: options.voiceInput,
  } satisfies PromptComposerController;
}

function createPromptComposerState(
  options: PromptComposerAssemblyOptions,
  canSubmit: boolean,
  openControlMenu: ComposerControlMenu | null,
): PromptComposerState {
  return {
    canSubmit,
    composerStatus: options.attachments.status?.text ?? options.voiceInput.status,
    composerStatusTone: options.attachments.status?.tone ?? options.voiceInput.tone,
    computerOpen: options.computerOpen,
    isMenuOpen: options.menu.triggers.isActive && options.menu.menuItems.length > 0,
    isRunning: options.isRunning,
    menuAriaLabel: options.menu.triggers.kind === "mention" ? "File mentions" : "Skills",
    menuItems: options.menu.menuItems,
    openControlMenu,
    selectedProject: options.projectSelection.selectedProject,
    selectedSkill: options.menu.selectedSkill,
    value: options.props.value,
  };
}

type ComposerSubmissionOptions = {
  canSubmit: boolean;
  isRunning: boolean;
  menu: ReturnType<typeof usePromptComposerMenu>;
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
  value,
}: ComposerSubmissionOptions) {
  function submitComposerValue() {
    const wasAccepted = onSubmit(
      composePromptWithComposerContext({ prompt: value, skill: menu.selectedSkill, tool: null }),
      project,
    );
    if (wasAccepted) {
      menu.setSelectedSkill(null);
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
    if (menu.triggers.handleMenuKeyDown(event, menu.menuItems)) {
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
