"use client";

import type { IntegrationName, ProjectSummary, RunIntent } from "@cheatcode/types";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { composePromptWithComposerContext } from "@/components/composer/composer-context-chips";
import type { ComposerIntent, IntentId } from "@/components/home/home-composer-intents";
import { resolveSubmitSkill, resolveSubmitSurface } from "@/components/home/home-composer-intents";
import { buildLaunchParams } from "@/components/home/home-composer-prompt-state";
import { type AgentModelId, agentModelRequestValue } from "@/lib/agent-models";
import { buildExistingProjectParams, launchIntoProject } from "@/lib/api/home-launch";
import { createChat, surfaceToMode, threadTitle } from "@/lib/api/project-thread";
import { assertUserMessageWithinLimit } from "@/lib/input/prompt-attachments";

interface HomeSubmissionState {
  agentModelId: AgentModelId;
  intent: ComposerIntent | null;
  intentId: IntentId | null;
  repoUrl: string | null;
  selectedProject: ProjectSummary | null;
  skillChip: string | null;
  skillCreatorMode: boolean;
  toolChip: IntegrationName | null;
  value: string;
}

interface HomeSubmissionSnapshot {
  intent: RunIntent | null;
  model: null | string;
  project: ProjectSummary | null;
  prompt: string;
  repoUrl: string | null;
  surface: "mobile" | "web" | null;
}

interface SubmissionRuntime {
  endSubmitting: () => void;
  getToken: () => Promise<null | string>;
  router: { push: (href: string) => void };
  setAuthRedirectTo: (redirectTo: null | string) => void;
}

export function useHomeComposerSubmission(input: {
  getToken: () => Promise<null | string>;
  router: SubmissionRuntime["router"];
  setAuthRedirectTo: (redirectTo: null | string) => void;
  state: HomeSubmissionState;
}) {
  const { getToken, router, setAuthRedirectTo, state } = input;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const endSubmitting = useCallback(() => {
    submittingRef.current = false;
    setIsSubmitting(false);
  }, []);
  const canSubmit = state.value.trim().length > 0 && !isSubmitting;

  const submit = useCallback(() => {
    if (!canSubmit || submittingRef.current) {
      return;
    }
    const snapshot = buildSubmissionSnapshot(state);
    if (!snapshot) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    void executeSubmission(snapshot, {
      endSubmitting,
      getToken,
      router,
      setAuthRedirectTo,
    });
  }, [canSubmit, endSubmitting, getToken, router, setAuthRedirectTo, state]);

  return { canSubmit, submit };
}

function buildSubmissionSnapshot(state: HomeSubmissionState): HomeSubmissionSnapshot | null {
  const skill = resolveSubmitSkill(state.repoUrl, state.intent, state.skillChip);
  const prompt = composePromptWithComposerContext({
    prompt: state.value.trim(),
    skill,
    tool: state.toolChip,
  });
  try {
    assertUserMessageWithinLimit(prompt);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "That message is too long.");
    return null;
  }
  return {
    intent: state.skillCreatorMode ? "skill-creator" : null,
    model: agentModelRequestValue(state.agentModelId) ?? null,
    project: state.selectedProject,
    prompt,
    repoUrl: state.repoUrl,
    surface: resolveSubmitSurface(state.repoUrl, state.intentId, state.intent, state.skillChip),
  };
}

async function executeSubmission(
  snapshot: HomeSubmissionSnapshot,
  runtime: SubmissionRuntime,
): Promise<void> {
  if (snapshot.project) {
    await launchExistingProject(snapshot, snapshot.project, runtime);
    return;
  }
  await startNewChat(snapshot, runtime);
}

async function launchExistingProject(
  snapshot: HomeSubmissionSnapshot,
  project: ProjectSummary,
  runtime: SubmissionRuntime,
): Promise<void> {
  try {
    const result = await launchIntoProject(runtime.getToken, project.id, snapshot.prompt);
    if (result.busy) {
      toast.error(
        "That project's latest thread is busy - wait for the run to finish or pick another project.",
      );
      runtime.endSubmitting();
      return;
    }
    navigateToChat(runtime.router, result.threadId, snapshot.prompt, snapshot.intent);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not open that project.");
    runtime.endSubmitting();
  }
}

async function startNewChat(
  snapshot: HomeSubmissionSnapshot,
  runtime: SubmissionRuntime,
): Promise<void> {
  const token = await runtime.getToken();
  if (!token) {
    preservePromptForSignIn(snapshot, runtime);
    return;
  }
  try {
    const thread = await createChat(runtime.getToken, {
      initialPrompt: snapshot.prompt,
      title: threadTitle(snapshot.prompt),
      mode: surfaceToMode(snapshot.surface),
      ...(snapshot.repoUrl ? { importRepoUrl: snapshot.repoUrl } : {}),
      ...(snapshot.model ? { defaultModel: snapshot.model } : {}),
    });
    navigateToChat(runtime.router, thread.id, snapshot.prompt, snapshot.intent);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not start that chat.");
    runtime.endSubmitting();
  }
}

function preservePromptForSignIn(
  snapshot: HomeSubmissionSnapshot,
  runtime: SubmissionRuntime,
): void {
  try {
    const params = buildLaunchParams({
      intent: snapshot.intent,
      model: snapshot.model,
      prompt: snapshot.prompt,
      repo: snapshot.repoUrl,
      surface: snapshot.surface,
    });
    runtime.setAuthRedirectTo(`/?${params.toString()}`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not preserve that prompt.");
  }
  runtime.endSubmitting();
}

function navigateToChat(
  router: SubmissionRuntime["router"],
  threadId: string,
  prompt: string,
  intent: RunIntent | null,
): void {
  const handoff = buildExistingProjectParams(prompt, intent).toString();
  router.push(`/chats/${encodeURIComponent(threadId)}?${handoff}`);
}
