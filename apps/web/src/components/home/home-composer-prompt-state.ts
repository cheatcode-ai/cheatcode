"use client";

import type { IntegrationName } from "@cheatcode/types";
import type { RunIntent } from "@cheatcode/types/api";
import type { AppBuildTarget } from "@/lib/app-build-target";
import { createPromptHandoff } from "@/lib/input/prompt-handoff";

export function buildLaunchParams(input: {
  appBuildTarget: AppBuildTarget | null;
  intent: RunIntent | null;
  model: null | string;
  prompt: string;
  repo: null | string;
  selectedSkill: null | string;
  selectedTool: IntegrationName | null;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (input.intent) {
    params.set("intent", input.intent);
  }
  if (input.prompt.length > 0) {
    params.set("promptKey", createPromptHandoff(input.prompt).promptKey);
  }
  if (input.appBuildTarget) {
    params.set("buildTarget", input.appBuildTarget);
  }
  if (input.model) {
    params.set("model", input.model);
  }
  if (input.repo) {
    params.set("repo", input.repo);
  }
  if (input.selectedSkill) {
    params.set("skill", input.selectedSkill);
  }
  if (input.selectedTool) {
    params.set("tool", input.selectedTool);
  }
  return params;
}

export function repoLabel(url: string): string {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : "repository";
}
