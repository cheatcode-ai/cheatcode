"use client";

import {
  type PromptComposerProps,
  usePromptComposerController,
} from "@/components/chat/prompt-composer-controller";
import { PromptComposerView } from "@/components/chat/prompt-composer-view";

export function PromptComposer(props: PromptComposerProps) {
  const controller = usePromptComposerController(props);
  return <PromptComposerView controller={controller} />;
}
