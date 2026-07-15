"use client";

import { useEffect, useState } from "react";
import { consumePromptHandoff, createPromptHandoff } from "@/lib/input/prompt-handoff";

const TYPEWRITER_SENTENCES = [
  "Plan my client onboarding flow and generate a progress report",
  "Build a landing page",
  "Create a mobile app",
  "Fix a bug",
] as const;

export function buildLaunchParams(input: {
  model: null | string;
  prompt: string;
  repo: null | string;
  surface: "mobile" | "web" | null;
}): URLSearchParams {
  const params = new URLSearchParams();
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

export function useTypewriterPlaceholder(): string {
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const sentence = TYPEWRITER_SENTENCES[sentenceIndex] ?? TYPEWRITER_SENTENCES[0];
    const isPausingAtEnd = !isDeleting && charIndex === sentence.length;
    const timeout = window.setTimeout(
      () => {
        if (!isDeleting) {
          if (charIndex === sentence.length) {
            setIsDeleting(true);
            return;
          }
          setCharIndex((current) => current + 1);
          return;
        }

        const nextIndex = charIndex - 1;
        setCharIndex(nextIndex);
        if (nextIndex === 0) {
          setIsDeleting(false);
          setSentenceIndex((current) => (current + 1) % TYPEWRITER_SENTENCES.length);
        }
      },
      isPausingAtEnd ? 600 : isDeleting ? 30 : 70,
    );

    return () => window.clearTimeout(timeout);
  }, [charIndex, isDeleting, sentenceIndex]);

  const sentence = TYPEWRITER_SENTENCES[sentenceIndex] ?? TYPEWRITER_SENTENCES[0];
  const placeholder = sentence.slice(0, charIndex);
  return placeholder.length > 0 ? placeholder : " ";
}

export function usePromptHandoff(promptKey: string | undefined): string | null {
  const [prompt, setPrompt] = useState<string | null>(null);

  useEffect(() => {
    if (!promptKey) {
      setPrompt(null);
      return;
    }
    setPrompt(consumePromptHandoff(promptKey));
  }, [promptKey]);

  return prompt;
}
