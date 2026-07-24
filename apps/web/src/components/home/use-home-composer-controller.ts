"use client";

import type { IntegrationName, UserSkill } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComposerMenuItem } from "@/components/composer/composer-popover";
import { useProjectFileItems } from "@/components/composer/project-file-source";
import { slashSkillItems } from "@/components/composer/slash-skill-source";
import {
  type TriggerDetector,
  useComposerTriggers,
} from "@/components/composer/use-composer-triggers";
import { useProjectFileUploads } from "@/components/composer/use-project-file-uploads";
import { resolveComposerAuthToken } from "@/components/home/home-composer-auth";
import { useHomeComposerSelection } from "@/components/home/use-home-composer-selection";
import { useHomeComposerSubmission } from "@/components/home/use-home-composer-submission";
import { useHomePromptState } from "@/components/home/use-home-prompt-state";
import { resolveInitialSkill } from "@/components/home/use-initial-skill";
import { listUserSkills, USER_SKILLS_QUERY } from "@/lib/api/skills";
import { usePromptHandoff } from "@/lib/hooks/use-prompt-handoff";
import { detectMentionToken, detectSlashToken } from "@/lib/input/caret-tokens";
import { useAppStore } from "@/lib/store/app-store";
import { emitComposerEvent } from "@/lib/telemetry/user-events";

const SLASH_DETECTOR: TriggerDetector = { detect: detectSlashToken, kind: "slash" };
const MENTION_DETECTOR: TriggerDetector = { detect: detectMentionToken, kind: "mention" };
const COMPOSER_SOURCES: readonly TriggerDetector[] = [SLASH_DETECTOR, MENTION_DETECTOR];

export interface HomeComposerProps {
  initialPromptKey?: string | undefined;
  initialSkill?: string | undefined;
  initialTool?: IntegrationName | undefined;
  quickActionsSlot?: HTMLElement | null | undefined;
  skillCreator?: boolean | undefined;
}

export function useHomeComposerController(input: HomeComposerProps) {
  const identity = useHomeComposerIdentity();
  const textarea = useHomeComposerTextarea();
  const prompt = useHomePromptState();
  useInitialPromptHandoff(input.initialPromptKey, prompt);
  const initialSkill = useResolvedInitialSkill(input.initialSkill);
  const selection = useHomeComposerSelection(
    {
      initialSkill,
      initialTool: input.initialTool ?? null,
      skillCreator: input.skillCreator ?? false,
    },
    textarea.focus,
  );
  const uploads = useProjectFileUploads({
    getToken: identity.getToken,
    latestValueRef: prompt.refs.latestValueRef,
    onChange: prompt.actions.publishValue,
    onProjectCreated: selection.actions.handleSelectProject,
    project: selection.state.selectedProject,
    value: prompt.state.value,
  });
  const [authRedirectTo, setAuthRedirectTo] = useState<string | null>(null);
  const composerMenu = useHomeComposerMenu({
    getToken: identity.getToken,
    projectId: selection.state.selectedProject?.id ?? null,
    publishValue: prompt.actions.publishValue,
    selectSkill: selection.actions.selectSkill,
    textareaRef: textarea.ref,
    value: prompt.state.value,
  });
  const submissionState = useHomeSubmissionState(identity.agentModelId, prompt, selection);
  const submission = useHomeComposerSubmission({
    getToken: identity.getToken,
    router: identity.router,
    setAuthRedirectTo,
    state: submissionState,
  });
  const canSubmit = submission.canSubmit && !uploads.isUploading;
  const submit = useHomeSubmit(submission.submit, canSubmit);
  const handleKeyDown = useComposerKeyDown(composerMenu, canSubmit, submit);
  const placeholder =
    selection.state.intent?.placeholder ?? "Ask anything, @ for skills, / for files";
  return homeComposerControllerValue({
    authRedirectTo,
    getToken: identity.getToken,
    handleKeyDown,
    placeholder,
    prompt,
    selection,
    setAuthRedirectTo,
    composerMenu,
    submission,
    submit,
    textareaRef: textarea.ref,
    uploads,
  });
}

function useHomeComposerIdentity() {
  const router = useRouter();
  const { getToken: getAuthToken } = useAuth();
  const getToken = useCallback(() => resolveComposerAuthToken(getAuthToken), [getAuthToken]);
  const agentModelId = useAppStore((state) => state.agentModelId);
  return { agentModelId, getToken, router };
}

function useHomeComposerTextarea() {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const focus = useCallback(() => ref.current?.focus(), []);
  return { focus, ref };
}

function useResolvedInitialSkill(initialSkill: string | undefined) {
  return useMemo(() => resolveInitialSkill(initialSkill ?? null), [initialSkill]);
}

function useInitialPromptHandoff(
  initialPromptKey: string | undefined,
  prompt: ReturnType<typeof useHomePromptState>,
): void {
  const handoffPrompt = usePromptHandoff(initialPromptKey);
  useEffect(() => {
    if (handoffPrompt && prompt.refs.latestValueRef.current.length === 0) {
      prompt.actions.publishValue(handoffPrompt);
    }
  }, [handoffPrompt, prompt.actions.publishValue, prompt.refs.latestValueRef]);
}

function useHomeSubmissionState(
  agentModelId: ReturnType<typeof useHomeComposerIdentity>["agentModelId"],
  prompt: ReturnType<typeof useHomePromptState>,
  selection: ReturnType<typeof useHomeComposerSelection>,
) {
  return useMemo(
    () => ({
      agentModelId,
      intent: selection.state.intent,
      intentId: selection.state.intentId,
      repoUrl: selection.state.repoUrl,
      selectedProject: selection.state.selectedProject,
      skillChip: selection.state.skillChip,
      skillCreatorMode: selection.state.skillCreatorMode,
      toolChip: selection.state.toolChip,
      value: prompt.state.value,
    }),
    [
      agentModelId,
      prompt.state.value,
      selection.state.intent,
      selection.state.intentId,
      selection.state.repoUrl,
      selection.state.selectedProject,
      selection.state.skillChip,
      selection.state.skillCreatorMode,
      selection.state.toolChip,
    ],
  );
}

function useHomeSubmit(submit: () => void, canSubmit: boolean) {
  return useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (canSubmit) submit();
    },
    [canSubmit, submit],
  );
}

interface HomeControllerParts {
  authRedirectTo: string | null;
  getToken: () => Promise<null | string>;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  prompt: ReturnType<typeof useHomePromptState>;
  selection: ReturnType<typeof useHomeComposerSelection>;
  setAuthRedirectTo: (value: string | null) => void;
  composerMenu: ReturnType<typeof useHomeComposerMenu>;
  submission: ReturnType<typeof useHomeComposerSubmission>;
  submit: (event?: FormEvent<HTMLFormElement>) => void;
  textareaRef: { current: HTMLTextAreaElement | null };
  uploads: ReturnType<typeof useProjectFileUploads>;
}

function homeComposerControllerValue(parts: HomeControllerParts) {
  return {
    actions: {
      ...parts.selection.actions,
      closeAuthModal: () => parts.setAuthRedirectTo(null),
      handleAttachmentChange: parts.uploads.onFileChange,
      openFilePicker: parts.uploads.openPicker,
      handleKeyDown: parts.handleKeyDown,
      publishValue: parts.prompt.actions.publishValue,
      submit: parts.submit,
    },
    menu: parts.composerMenu,
    meta: { getToken: parts.getToken },
    refs: {
      attachmentInputRef: parts.uploads.inputRef,
      textareaRef: parts.textareaRef,
    },
    state: {
      ...parts.selection.state,
      attachmentStatus: parts.uploads.status,
      authRedirectTo: parts.authRedirectTo,
      canSubmit: parts.submission.canSubmit && !parts.uploads.isUploading,
      placeholder: parts.placeholder,
      value: parts.prompt.state.value,
    },
  };
}

function useHomeComposerMenu(input: {
  getToken: () => Promise<null | string>;
  projectId: null | string;
  publishValue: (value: string) => void;
  selectSkill: (skill: string) => void;
  textareaRef: { current: HTMLTextAreaElement | null };
  value: string;
}) {
  const { data: userSkills } = useQuery({
    queryFn: ({ signal }) => listUserSkills(input.getToken, signal),
    queryKey: USER_SKILLS_QUERY,
    staleTime: 60_000,
  });
  const triggers = useComposerTriggers({
    onChange: input.publishValue,
    onInsert: (kind, item) => {
      if (kind === "mention") selectSkillItem(item, input.selectSkill);
      emitComposerEvent(
        input.getToken,
        kind === "mention" ? "composer_mention_inserted" : "composer_slash_inserted",
      );
    },
    sources: COMPOSER_SOURCES,
    textareaRef: input.textareaRef,
    value: input.value,
  });
  const fileItems = useProjectFileItems({
    enabled: triggers.kind === "slash",
    projectId: input.projectId,
    query: triggers.query,
  });
  const items = resolveHomeMenuItems({
    fileItems,
    triggers,
    userSkills: userSkills ?? [],
  });
  return {
    ariaLabel: triggers.kind === "slash" ? "Project files" : "Skills",
    isOpen: triggers.isActive && items.length > 0,
    items,
    triggers,
  };
}

function resolveHomeMenuItems(input: {
  fileItems: ComposerMenuItem[];
  triggers: ReturnType<typeof useComposerTriggers>;
  userSkills: UserSkill[];
}): ComposerMenuItem[] {
  if (input.triggers.kind === "slash") return input.fileItems;
  const items = slashSkillItems(input.triggers.query, input.userSkills);
  if (items.length > 0) return items;
  return [statusMenuItem("No matching skills")];
}

function statusMenuItem(label: string): ComposerMenuItem {
  return { disabled: true, id: `status:${label}`, insert: "", label, visual: "status" };
}

function selectSkillItem(item: ComposerMenuItem, selectSkill: (skill: string) => void) {
  if (item.skillName) selectSkill(item.skillName);
}

function useComposerKeyDown(
  menu: ReturnType<typeof useHomeComposerMenu>,
  canSubmit: boolean,
  submit: () => void,
) {
  return useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (menu.triggers.handleMenuKeyDown(event, menu.items)) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) {
        event.preventDefault();
        submit();
      }
    },
    [canSubmit, menu.items, menu.triggers, submit],
  );
}
