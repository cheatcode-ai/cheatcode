"use client";

import { SKILL_MANIFEST } from "@cheatcode/skills/manifest";
import { type IntegrationName, IntegrationNameSchema } from "@cheatcode/types";
import { useEffect, useState } from "react";
import { HomeComposer } from "./home-composer";

const INITIAL_PROMPT_MAX_LENGTH = 4_000;

type InitialComposerParams = {
  prompt?: string | undefined;
  promptKey?: string | undefined;
  skill?: string | undefined;
  tool?: IntegrationName | undefined;
};

export function HomeComposerFromSearchParams() {
  const [params, setParams] = useState<InitialComposerParams | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    setParams({
      prompt: validInitialPrompt(searchParams.get("prompt")),
      promptKey: validInitialPromptKey(searchParams.get("promptKey")),
      skill: validInitialSkill(searchParams.get("skill")),
      tool: validInitialTool(searchParams.get("tool")),
    });
  }, []);

  if (!params) {
    return <HomeComposer />;
  }

  return (
    <HomeComposer
      initialPrompt={params.prompt}
      initialPromptKey={params.promptKey}
      initialSkill={params.skill}
      initialTool={params.tool}
      key={`${params.promptKey ?? ""}:${params.skill ?? ""}:${params.tool ?? ""}`}
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

function validInitialPrompt(value: string | null): string | undefined {
  if (value && value.length <= INITIAL_PROMPT_MAX_LENGTH) {
    return value;
  }
  return undefined;
}

function validInitialPromptKey(value: string | null): string | undefined {
  if (value && /^[\w-]{8,80}$/.test(value)) {
    return value;
  }
  return undefined;
}
