"use client";

import { useEffect, useRef, useState } from "react";
import { consumePromptHandoff } from "@/lib/input/prompt-handoff";

interface ConsumedPrompt {
  prompt: null | string;
  promptKey: string;
}

export function usePromptHandoff(promptKey: null | string | undefined): null | string | undefined {
  const consumedRef = useRef<ConsumedPrompt | null>(null);
  const [prompt, setPrompt] = useState<null | string | undefined>(promptKey ? undefined : null);

  useEffect(() => {
    if (!promptKey) {
      consumedRef.current = null;
      setPrompt(null);
      return;
    }
    if (consumedRef.current?.promptKey !== promptKey) {
      consumedRef.current = { prompt: consumePromptHandoff(promptKey), promptKey };
    }
    setPrompt(consumedRef.current.prompt);
  }, [promptKey]);

  return prompt;
}
