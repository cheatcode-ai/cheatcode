"use client";

import { SKILL_MANIFEST } from "@cheatcode/skills/manifest";
import { type IntegrationName, IntegrationNameSchema } from "@cheatcode/types";
import { GitHubRepoUrlSchema } from "@cheatcode/types/api";
import { useEffect, useState } from "react";
import { type AgentModelId, isAgentModelId } from "@/lib/agent-models";
import { type AppBuildTarget, isAppBuildTarget } from "@/lib/app-build-target";
import { HomeComposer } from "./home-composer";

type InitialComposerParams = {
  appBuildTarget?: AppBuildTarget | undefined;
  model?: AgentModelId | undefined;
  promptKey?: string | undefined;
  repoUrl?: string | undefined;
  skill?: string | undefined;
  skillCreator?: boolean | undefined;
  tool?: IntegrationName | undefined;
};

export function HomeComposerFromSearchParams({
  quickActionsSlot,
}: {
  quickActionsSlot?: HTMLElement | null | undefined;
}) {
  const [params, setParams] = useState<InitialComposerParams | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    setParams({
      appBuildTarget: validAppBuildTarget(searchParams.get("buildTarget")),
      model: validInitialModel(searchParams.get("model")),
      promptKey: validInitialPromptKey(searchParams.get("promptKey")),
      repoUrl: validInitialRepoUrl(searchParams.get("repo")),
      skill: validInitialSkill(searchParams.get("skill")),
      skillCreator: searchParams.get("intent") === "skill-creator",
      tool: validInitialTool(searchParams.get("tool")),
    });
  }, []);

  if (!params) {
    return <HomeComposer quickActionsSlot={quickActionsSlot} />;
  }

  return (
    <HomeComposer
      initialAppBuildTarget={params.appBuildTarget}
      initialModel={params.model}
      initialPromptKey={params.promptKey}
      initialRepoUrl={params.repoUrl}
      initialSkill={params.skill}
      initialTool={params.tool}
      key={`${params.promptKey ?? ""}:${params.skill ?? ""}:${params.tool ?? ""}:${params.appBuildTarget ?? ""}:${params.model ?? ""}:${params.repoUrl ?? ""}:${params.skillCreator ? "sc" : ""}`}
      quickActionsSlot={quickActionsSlot}
      skillCreator={params.skillCreator}
    />
  );
}

function validAppBuildTarget(value: string | null): AppBuildTarget | undefined {
  return isAppBuildTarget(value) ? value : undefined;
}

function validInitialModel(value: string | null): AgentModelId | undefined {
  return isAgentModelId(value) ? value : undefined;
}

function validInitialRepoUrl(value: string | null): string | undefined {
  const result = GitHubRepoUrlSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function validInitialSkill(value: string | null): string | undefined {
  if (value && SKILL_MANIFEST.some((skill) => skill.name === value)) {
    return value;
  }
  return undefined;
}

function validInitialTool(value: string | null): IntegrationName | undefined {
  const result = IntegrationNameSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function validInitialPromptKey(value: string | null): string | undefined {
  if (value && /^[\w-]{8,80}$/.test(value)) {
    return value;
  }
  return undefined;
}
