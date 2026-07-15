"use client";

import { type ChangeEvent, useCallback, useRef, useState } from "react";
import { appendPromptAttachment, readPromptAttachment } from "@/lib/input/prompt-attachments";

export type AttachmentStatus = {
  text: string;
  tone: "error" | "ok";
};

export function useHomePromptState() {
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [attachmentStatus, setAttachmentStatus] = useState<AttachmentStatus | null>(null);
  const [value, setValue] = useState("");
  const latestValueRef = useRef(value);

  const publishValue = useCallback((nextValue: string) => {
    latestValueRef.current = nextValue;
    setValue(nextValue);
  }, []);

  const handleAttachmentChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0) {
        return;
      }
      try {
        const attachments = await Promise.all(files.slice(0, 5).map(readPromptAttachment));
        publishValue(attachments.reduce(appendPromptAttachment, latestValueRef.current));
        setAttachmentStatus(successfulAttachmentStatus(attachments.map(({ name }) => name)));
      } catch (error) {
        setAttachmentStatus({
          tone: "error",
          text: error instanceof Error ? error.message : "Could not attach that file.",
        });
      }
    },
    [publishValue],
  );

  return {
    actions: { handleAttachmentChange, publishValue },
    refs: { attachmentInputRef, latestValueRef },
    state: { attachmentStatus, value },
  };
}

function successfulAttachmentStatus(names: readonly string[]): AttachmentStatus {
  return {
    tone: "ok",
    text: names.length === 1 ? `Attached ${names[0]}` : `Attached ${names.length} files`,
  };
}
