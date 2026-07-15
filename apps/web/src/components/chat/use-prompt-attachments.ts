"use client";

import { type ChangeEvent, type RefObject, useRef, useState } from "react";
import { appendPromptAttachment, readPromptAttachment } from "@/lib/input/prompt-attachments";

export type ComposerStatusTone = "error" | "ok";

interface AttachmentStatus {
  text: string;
  tone: ComposerStatusTone;
}

export interface PromptAttachments {
  inputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  status: AttachmentStatus | null;
}

export function usePromptAttachments({
  latestValueRef,
  onChange,
}: {
  latestValueRef: { current: string };
  onChange: (value: string) => void;
}): PromptAttachments {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<AttachmentStatus | null>(null);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }
    try {
      const attachments = await Promise.all(files.slice(0, 5).map(readPromptAttachment));
      const nextValue = attachments.reduce(appendPromptAttachment, latestValueRef.current);
      latestValueRef.current = nextValue;
      onChange(nextValue);
      setStatus(attachedStatus(attachments.map((attachment) => attachment.name)));
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not attach that file.",
      });
    }
  }

  return { inputRef, onFileChange, status };
}

function attachedStatus(names: readonly string[]): AttachmentStatus {
  return {
    tone: "ok",
    text: names.length === 1 ? `Attached ${names[0]}` : `Attached ${names.length} files`,
  };
}
