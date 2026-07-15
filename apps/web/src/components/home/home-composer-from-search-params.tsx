"use client";

import { SKILL_MANIFEST } from "@cheatcode/skills/manifest";
import { type IntegrationName, IntegrationNameSchema } from "@cheatcode/types";
import { useEffect, useState } from "react";
import { HomeComposer } from "./home-composer";

type InitialComposerParams = {
  promptKey?: string | undefined;
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
      promptKey: validInitialPromptKey(searchParams.get("promptKey")),
      skill: validInitialSkill(searchParams.get("skill")),
      skillCreator: searchParams.get("mode") === "skill-creator",
      tool: validInitialTool(searchParams.get("tool")),
    });
  }, []);

  if (!params) {
    return <HomeComposer quickActionsSlot={quickActionsSlot} />;
  }

  return (
    <HomeComposer
      initialPromptKey={params.promptKey}
      initialSkill={params.skill}
      initialTool={params.tool}
      key={`${params.promptKey ?? ""}:${params.skill ?? ""}:${params.tool ?? ""}:${params.skillCreator ? "sc" : ""}`}
      quickActionsSlot={quickActionsSlot}
      skillCreator={params.skillCreator}
    />
  );
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
