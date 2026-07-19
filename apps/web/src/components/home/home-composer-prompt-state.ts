"use client";

import type { RunIntent } from "@cheatcode/types";
import { createPromptHandoff } from "@/lib/input/prompt-handoff";

export function buildLaunchParams(input: {
  intent: RunIntent | null;
  model: null | string;
  prompt: string;
  repo: null | string;
  surface: "mobile" | "web" | null;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (input.intent) {
    params.set("intent", input.intent);
  }
  if (input.prompt.length > 0) {
    params.set("promptKey", createPromptHandoff(input.prompt).promptKey);
  }
  if (input.surface) {
    params.set("surface", input.surface);
  }
  if (input.model) {
    params.set("model", input.model);
  }
  if (input.repo) {
    params.set("repo", input.repo);
  }
  return params;
}

export function repoLabel(url: string): string {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : "repository";
}
