"use client";

import type { IntegrationName } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
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
import { useComposerMenu } from "@/components/composer/use-composer-menu";
import { useProjectFileUploads } from "@/components/composer/use-project-file-uploads";
import { resolveComposerAuthToken } from "@/components/home/home-composer-auth";
import { useHomeComposerSelection } from "@/components/home/use-home-composer-selection";
import { useHomeComposerSubmission } from "@/components/home/use-home-composer-submission";
import { useHomePromptState } from "@/components/home/use-home-prompt-state";
import { resolveInitialSkill } from "@/components/home/use-initial-skill";
import type { AgentModelId } from "@/lib/agent-models";
import type { AppBuildTarget } from "@/lib/app-build-target";
import { usePromptHandoff } from "@/lib/hooks/use-prompt-handoff";
import { useAppStore } from "@/lib/store/app-store";

export interface HomeComposerProps {
  initialAppBuildTarget?: AppBuildTarget | undefined;
  initialModel?: AgentModelId | undefined;
  initialPromptKey?: string | undefined;
  initialRepoUrl?: string | undefined;
  initialSkill?: string | undefined;
  initialTool?: IntegrationName | undefined;
  quickActionsSlot?: HTMLElement | null | undefined;
  skillCreator?: boolean | undefined;
}

export function useHomeComposerController(input: HomeComposerProps) {
  const identity = useHomeComposerIdentity(input.initialModel);
  const textarea = useHomeComposerTextarea();
  const prompt = useHomePromptState();
  useInitialPromptHandoff(input.initialPromptKey, prompt);
  const selection = useInitialHomeSelection(input, textarea.focus);
  const uploads = useProjectFileUploads({
    getToken: identity.getToken,
    latestValueRef: prompt.refs.latestValueRef,
    onChange: prompt.actions.publishValue,
    onProjectCreated: selection.actions.handleSelectProject,
    project: selection.state.selectedProject,
    value: prompt.state.value,
  });
  const [authRedirectTo, setAuthRedirectTo] = useState<string | null>(null);
  const composerMenu = useComposerMenu({
    getToken: identity.getToken,
    onChange: prompt.actions.publishValue,
    onSelectSkill: selection.actions.selectSkill,
    onSelectTool: selection.actions.selectTool,
    projectId: selection.state.selectedProject?.id ?? null,
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

function useInitialHomeSelection(input: HomeComposerProps, focusTextarea: () => void) {
  const initialSkill = useResolvedInitialSkill(input.initialSkill);
  return useHomeComposerSelection(
    {
      appBuildTarget: input.initialAppBuildTarget ?? null,
      initialSkill,
      initialTool: input.initialTool ?? null,
      repoUrl: input.initialRepoUrl ?? null,
      skillCreator: input.skillCreator ?? false,
    },
    focusTextarea,
  );
}

function useHomeComposerIdentity(initialModel: AgentModelId | undefined) {
  const router = useRouter();
  const { getToken: getAuthToken } = useAuth();
  const getToken = useCallback(() => resolveComposerAuthToken(getAuthToken), [getAuthToken]);
  const agentModelId = useAppStore((state) => state.agentModelId);
  useInitialAgentModel(initialModel);
  return { agentModelId, getToken, router };
}

function useInitialAgentModel(initialModel: AgentModelId | undefined): void {
  useEffect(() => {
    if (!initialModel) return;
    const applyInitialModel = () => useAppStore.getState().setAgentModelId(initialModel);
    const unsubscribe = useAppStore.persist.onFinishHydration(applyInitialModel);
    if (useAppStore.persist.hasHydrated()) {
      applyInitialModel();
    }
    return unsubscribe;
  }, [initialModel]);
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
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  prompt: ReturnType<typeof useHomePromptState>;
  selection: ReturnType<typeof useHomeComposerSelection>;
  setAuthRedirectTo: (value: string | null) => void;
  composerMenu: ReturnType<typeof useComposerMenu>;
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

function useComposerKeyDown(
  menu: ReturnType<typeof useComposerMenu>,
  canSubmit: boolean,
  submit: () => void,
) {
  return useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (menu.handleKeyDown(event)) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) {
        event.preventDefault();
        submit();
      }
    },
    [canSubmit, menu.handleKeyDown, submit],
  );
}
