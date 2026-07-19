"use client";

import type { IntegrationName, ProjectSummary } from "@cheatcode/types";
import { useCallback, useState } from "react";
import { COMPOSER_INTENTS, type IntentId } from "@/components/home/home-composer-intents";
import { resolveInitialSkill } from "@/components/home/use-initial-skill";

interface InitialSelection {
  initialSkill: ReturnType<typeof resolveInitialSkill>;
  initialTool: IntegrationName | null;
  skillCreator: boolean;
}

export function useHomeComposerSelection(initial: InitialSelection, focusTextarea: () => void) {
  const state = useHomeSelectionState(initial);
  const intentActions = useIntentSelectionActions(state, focusTextarea);
  const skillActions = useSkillSelectionActions(state, focusTextarea);
  const resourceActions = useResourceSelectionActions(state);
  return {
    actions: {
      ...intentActions,
      ...resourceActions,
      ...skillActions,
      clearRepo: () => state.setRepoUrl(null),
      clearTool: () => state.setToolChip(null),
      exitSkillCreator: () => state.setSkillCreatorMode(false),
    },
    state: publicSelectionState(state),
  };
}

function useHomeSelectionState(initial: InitialSelection) {
  const [intentId, setIntentId] = useState<IntentId | null>(initial.initialSkill.intent);
  const [skillChip, setSkillChip] = useState<string | null>(initial.initialSkill.chip);
  const [toolChip, setToolChip] = useState<IntegrationName | null>(initial.initialTool);
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const [skillCreatorMode, setSkillCreatorMode] = useState(initial.skillCreator);
  const intent = COMPOSER_INTENTS.find((candidate) => candidate.id === intentId) ?? null;
  return {
    intent,
    intentId,
    repoUrl,
    selectedProject,
    setIntentId,
    setRepoUrl,
    setSelectedProject,
    setSkillChip,
    setSkillCreatorMode,
    setToolChip,
    skillChip,
    skillCreatorMode,
    toolChip,
  };
}

function useIntentSelectionActions(
  state: ReturnType<typeof useHomeSelectionState>,
  focusTextarea: () => void,
) {
  const { intent, intentId, repoUrl, setIntentId, setRepoUrl, setSkillChip, skillChip } = state;
  const toggleIntent = useCallback(
    (nextId: IntentId) => {
      const nextIntent = COMPOSER_INTENTS.find((candidate) => candidate.id === nextId) ?? null;
      const isClearing = intentId === nextId;
      setIntentId(isClearing ? null : nextId);
      setSkillChip(isClearing ? null : (nextIntent?.skill ?? null));
      if (repoUrl && nextId !== "mobile-app" && nextId !== "web-app") {
        setRepoUrl(null);
      }
    },
    [intentId, repoUrl, setIntentId, setRepoUrl, setSkillChip],
  );

  const clearIntent = useCallback(() => {
    if (intent?.skill && skillChip === intent.skill) {
      setSkillChip(null);
    }
    setIntentId(null);
    focusTextarea();
  }, [focusTextarea, intent, setIntentId, setSkillChip, skillChip]);

  const selectQuickIntent = useCallback(
    (nextId: IntentId) => {
      toggleIntent(nextId);
      window.requestAnimationFrame(focusTextarea);
    },
    [focusTextarea, toggleIntent],
  );
  return { clearIntent, selectQuickIntent, toggleIntent };
}

function useResourceSelectionActions(state: ReturnType<typeof useHomeSelectionState>) {
  const { intentId, setIntentId, setRepoUrl, setSelectedProject, setSkillChip } = state;
  const handleRepoAttach = useCallback(
    (url: string) => {
      setRepoUrl(url);
      setSkillChip(null);
      if (intentId !== "mobile-app" && intentId !== "web-app") {
        setIntentId(null);
      }
    },
    [intentId, setIntentId, setRepoUrl, setSkillChip],
  );

  const handleSelectProject = useCallback(
    (project: ProjectSummary | null) => {
      setSelectedProject(project);
      if (project) {
        setRepoUrl(null);
      }
    },
    [setRepoUrl, setSelectedProject],
  );
  return { handleRepoAttach, handleSelectProject };
}

function useSkillSelectionActions(
  state: ReturnType<typeof useHomeSelectionState>,
  focusTextarea: () => void,
) {
  const { intent, setIntentId, setRepoUrl, setSkillChip, setToolChip, skillChip } = state;
  const selectSkill = useCallback(
    (skill: string) => {
      const nextInitial = resolveInitialSkill(skill);
      setIntentId(nextInitial.intent);
      // User-generated skills are not part of the build-time manifest, but they
      // still need the same visible composer context and submission contract.
      setSkillChip(nextInitial.chip ?? skill);
      setToolChip(null);
      setRepoUrl(null);
    },
    [setIntentId, setRepoUrl, setSkillChip, setToolChip],
  );
  const selectTool = useCallback(
    (tool: IntegrationName) => {
      setIntentId(null);
      setSkillChip(null);
      setToolChip(tool);
      setRepoUrl(null);
    },
    [setIntentId, setRepoUrl, setSkillChip, setToolChip],
  );
  const clearSkillSelection = useCallback(() => {
    if (intent?.skill && skillChip === intent.skill) {
      setIntentId(null);
    }
    setSkillChip(null);
    focusTextarea();
  }, [focusTextarea, intent, setIntentId, setSkillChip, skillChip]);
  return { clearSkillSelection, selectSkill, selectTool };
}

function publicSelectionState(state: ReturnType<typeof useHomeSelectionState>) {
  return {
    intent: state.intent,
    intentId: state.intentId,
    repoUrl: state.repoUrl,
    selectedProject: state.selectedProject,
    skillChip: state.skillChip,
    skillCreatorMode: state.skillCreatorMode,
    toolChip: state.toolChip,
  };
}
