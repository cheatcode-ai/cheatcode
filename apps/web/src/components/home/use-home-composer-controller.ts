"use client";

import type { IntegrationName } from "@cheatcode/types";
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
import { slashSkillItems } from "@/components/composer/slash-skill-source";
import {
  type TriggerDetector,
  useComposerTriggers,
} from "@/components/composer/use-composer-triggers";
import { resolveComposerAuthToken } from "@/components/home/home-composer-auth";
import {
  usePromptHandoff,
  useTypewriterPlaceholder,
} from "@/components/home/home-composer-prompt-state";
import { useHomeComposerSelection } from "@/components/home/use-home-composer-selection";
import { useHomeComposerSubmission } from "@/components/home/use-home-composer-submission";
import { useHomePromptState } from "@/components/home/use-home-prompt-state";
import { resolveInitialSkill } from "@/components/home/use-initial-skill";
import { listUserSkills, USER_SKILLS_QUERY } from "@/lib/api/skills";
import { detectSlashToken } from "@/lib/input/caret-tokens";
import { useAppStore } from "@/lib/store/app-store";
import { emitComposerEvent } from "@/lib/telemetry/user-events";

const SLASH_DETECTOR: TriggerDetector = { detect: detectSlashToken, kind: "slash" };
const SLASH_SOURCES: readonly TriggerDetector[] = [SLASH_DETECTOR];

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
  const [authRedirectTo, setAuthRedirectTo] = useState<string | null>(null);
  const slashMenu = useHomeSlashMenu({
    getToken: identity.getToken,
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
  const submit = useHomeSubmit(submission.submit);
  const handleKeyDown = useComposerKeyDown(slashMenu, submission.canSubmit, submit);
  const typewriterPlaceholder = useTypewriterPlaceholder();
  const placeholder = selection.state.intent?.placeholder ?? typewriterPlaceholder;
  return homeComposerControllerValue({
    authRedirectTo,
    getToken: identity.getToken,
    handleKeyDown,
    placeholder,
    prompt,
    selection,
    setAuthRedirectTo,
    slashMenu,
    submission,
    submit,
    textareaRef: textarea.ref,
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
      selection.state.toolChip,
    ],
  );
}

function useHomeSubmit(submit: () => void) {
  return useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      submit();
    },
    [submit],
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
  slashMenu: ReturnType<typeof useHomeSlashMenu>;
  submission: ReturnType<typeof useHomeComposerSubmission>;
  submit: (event?: FormEvent<HTMLFormElement>) => void;
  textareaRef: { current: HTMLTextAreaElement | null };
}

function homeComposerControllerValue(parts: HomeControllerParts) {
  return {
    actions: {
      ...parts.selection.actions,
      closeAuthModal: () => parts.setAuthRedirectTo(null),
      handleAttachmentChange: parts.prompt.actions.handleAttachmentChange,
      handleKeyDown: parts.handleKeyDown,
      publishValue: parts.prompt.actions.publishValue,
      submit: parts.submit,
    },
    menu: parts.slashMenu,
    meta: { getToken: parts.getToken },
    refs: {
      attachmentInputRef: parts.prompt.refs.attachmentInputRef,
      textareaRef: parts.textareaRef,
    },
    state: {
      ...parts.selection.state,
      attachmentStatus: parts.prompt.state.attachmentStatus,
      authRedirectTo: parts.authRedirectTo,
      canSubmit: parts.submission.canSubmit,
      placeholder: parts.placeholder,
      value: parts.prompt.state.value,
    },
  };
}

function useHomeSlashMenu(input: {
  getToken: () => Promise<null | string>;
  publishValue: (value: string) => void;
  selectSkill: (skill: string) => void;
  textareaRef: { current: HTMLTextAreaElement | null };
  value: string;
}) {
  const { data: userSkills } = useQuery({
    queryFn: () => listUserSkills(input.getToken),
    queryKey: USER_SKILLS_QUERY,
    staleTime: 60_000,
  });
  const triggers = useComposerTriggers({
    onChange: input.publishValue,
    onInsert: (_kind, item) => {
      input.selectSkill(item.id);
      emitComposerEvent(input.getToken, "composer_slash_inserted");
    },
    sources: SLASH_SOURCES,
    textareaRef: input.textareaRef,
    value: input.value,
  });
  const items = slashSkillItems(triggers.query, userSkills ?? []);
  return {
    isOpen: triggers.kind === "slash" && triggers.isActive && items.length > 0,
    items,
    triggers,
  };
}

function useComposerKeyDown(
  menu: ReturnType<typeof useHomeSlashMenu>,
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
