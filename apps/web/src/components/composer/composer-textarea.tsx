"use client";

import { USER_MESSAGE_MAX_CHARACTERS } from "@cheatcode/types/api";
import type { KeyboardEvent, RefObject } from "react";
import { COMPOSER_TEXTAREA_CLASS } from "@/components/composer/composer-frame";
import type { ComposerTriggers } from "@/components/composer/use-composer-triggers";
import { cn } from "@/lib/ui/cn";

interface ComposerTextareaProps {
  className?: string | undefined;
  id: string;
  label: string;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  triggers: ComposerTriggers;
  value: string;
}

export function ComposerTextarea({
  className,
  id,
  label,
  onKeyDown,
  placeholder,
  textareaRef,
  triggers,
  value,
}: ComposerTextareaProps) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <textarea
        className={cn(COMPOSER_TEXTAREA_CLASS, className)}
        id={id}
        maxLength={USER_MESSAGE_MAX_CHARACTERS}
        onChange={triggers.onTextareaChange}
        onClick={triggers.onTextareaSelect}
        onKeyDown={onKeyDown}
        onKeyUp={triggers.onTextareaSelect}
        onSelect={triggers.onTextareaSelect}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={value}
      />
    </>
  );
}
