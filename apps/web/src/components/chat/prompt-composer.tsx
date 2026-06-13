"use client";

import { useAuth } from "@clerk/nextjs";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RunStatus } from "@/components/chat/status-pill";
import { ComposerPopover } from "@/components/composer/composer-popover";
import { useMentionFileItems } from "@/components/composer/mention-file-source";
import { ModelMenu } from "@/components/composer/model-menu";
import { slashSkillItems } from "@/components/composer/slash-skill-source";
import {
  type TriggerDetector,
  useComposerTriggers,
} from "@/components/composer/use-composer-triggers";
import { ArrowUp, DollarSign, Mic, Paperclip, Square } from "@/components/ui/icons";
import { detectMentionToken, detectSlashToken } from "@/lib/input/caret-tokens";
import {
  appendPromptAttachment,
  PROMPT_ATTACHMENT_ACCEPT,
  readPromptAttachment,
} from "@/lib/input/prompt-attachments";
import { useAppStore } from "@/lib/store/app-store";
import { emitComposerEvent } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";

const SLASH_DETECTOR: TriggerDetector = { detect: detectSlashToken, kind: "slash" };
const MENTION_DETECTOR: TriggerDetector = { detect: detectMentionToken, kind: "mention" };

interface PromptComposerProps {
  budgetCapUsd: number | null;
  onBudgetChange: (value: number | null) => void;
  onChange: (value: string) => void;
  onStop: () => void;
  onSubmit: (value: string) => void;
  status: RunStatus;
  threadId: string;
  value: string;
}

export function PromptComposer({
  budgetCapUsd,
  onBudgetChange,
  onChange,
  onStop,
  onSubmit,
  status,
  threadId,
  value,
}: PromptComposerProps) {
  const { getToken } = useAuth();
  const isRunning = status === "streaming" || status === "submitted";
  const canSubmit = value.trim().length > 0 && !isRunning;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sandboxReady = useAppStore((state) => state.sandboxStatus === "ready");
  const attachments = usePromptAttachments({ currentValue: value, onChange });
  const voiceInput = useVoiceInput({
    currentValue: value,
    disabled: isRunning,
    onChange,
  });
  const composerStatus = attachments.status?.text ?? voiceInput.status;
  const composerStatusTone = attachments.status?.tone ?? voiceInput.tone;
  const sources = useMemo(
    () => (sandboxReady ? [SLASH_DETECTOR, MENTION_DETECTOR] : [SLASH_DETECTOR]),
    [sandboxReady],
  );
  const triggers = useComposerTriggers({
    onChange,
    onInsert: (kind) =>
      emitComposerEvent(
        getToken,
        kind === "mention" ? "composer_mention_inserted" : "composer_slash_inserted",
      ),
    sources,
    textareaRef,
    value,
  });
  const mentionItems = useMentionFileItems({
    enabled: sandboxReady && triggers.kind === "mention",
    query: triggers.query,
    threadId,
  });
  const menuItems = triggers.kind === "mention" ? mentionItems : slashSkillItems(triggers.query);
  const isMenuOpen = triggers.isActive && menuItems.length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRunning) {
      onStop();
      return;
    }
    if (canSubmit) {
      onSubmit(value.trim());
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (triggers.handleMenuKeyDown(event, menuItems)) {
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (canSubmit) {
        onSubmit(value.trim());
      }
    }
    if (event.key === "Escape" && isRunning) {
      event.preventDefault();
      onStop();
    }
  }

  return (
    <form
      className="absolute right-0 bottom-0 left-0 z-10 bg-gradient-to-t from-background via-background/90 to-transparent pt-8 pb-6"
      onSubmit={handleSubmit}
    >
      <div className="relative z-10 mx-auto flex w-full max-w-3xl items-end justify-center gap-3 px-4">
        {isMenuOpen ? (
          <ComposerPopover
            activeIndex={triggers.activeIndex}
            ariaLabel={triggers.kind === "mention" ? "File mentions" : "Skills"}
            items={menuItems}
            onHoverIndex={triggers.setActiveIndex}
            onSelectIndex={(index) => triggers.commitIndex(index, menuItems)}
          />
        ) : null}
        <div
          className={cn(
            "w-full overflow-hidden rounded-2xl border border-thread-border bg-thread-surface px-4 py-2",
            "shadow-2xl transition-colors focus-within:border-thread-border-hover",
          )}
        >
          <div className="flex flex-col justify-between">
            <div className="flex flex-col gap-1 px-4">
              <div className="flex items-start gap-2 pt-4">
                <label className="sr-only" htmlFor="prompt">
                  Message Cheatcode
                </label>
                <textarea
                  className="max-h-[200px] min-h-9 w-full resize-none overflow-y-auto border-none bg-transparent px-0 pt-0 pb-6 font-mono text-[15px] text-white/90 outline-none placeholder:text-zinc-600"
                  id="prompt"
                  onChange={triggers.onTextareaChange}
                  onClick={triggers.onTextareaSelect}
                  onKeyDown={handleKeyDown}
                  onKeyUp={triggers.onTextareaSelect}
                  onSelect={triggers.onTextareaSelect}
                  placeholder="ask cheatcode to build anything ..."
                  ref={textareaRef}
                  rows={1}
                  value={value}
                />
              </div>
            </div>
            <div className="relative mt-0 mb-1 flex items-center justify-between px-2">
              <div className="z-10 flex items-center gap-3">
                <input
                  accept={PROMPT_ATTACHMENT_ACCEPT}
                  className="sr-only"
                  multiple
                  onChange={attachments.onFileChange}
                  ref={attachments.inputRef}
                  tabIndex={-1}
                  type="file"
                />
                <button
                  aria-label="Attach file"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-white"
                  onClick={() => attachments.inputRef.current?.click()}
                  type="button"
                >
                  <Paperclip aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              <div className="z-10 flex items-center gap-2">
                <ModelMenu variant="thread" />
                <BudgetCapControl onChange={onBudgetChange} value={budgetCapUsd} />
                <VoiceInputButton isDisabled={isRunning} voiceInput={voiceInput} />
                <SendActionButton canSubmit={canSubmit} isRunning={isRunning} />
              </div>
            </div>
          </div>
          <ComposerStatusLine status={composerStatus} tone={composerStatusTone} />
        </div>
      </div>
    </form>
  );
}

function VoiceInputButton({
  isDisabled,
  voiceInput,
}: {
  isDisabled: boolean;
  voiceInput: VoiceInputState;
}) {
  const disabled = !voiceInput.isSupported || isDisabled;
  return (
    <button
      aria-label={voiceInput.isListening ? "Stop voice input" : "Start voice input"}
      className={cn(
        "hidden h-8 w-8 items-center justify-center rounded-full transition-colors sm:flex",
        voiceInput.isListening
          ? "bg-red-500/10 text-red-300"
          : "text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300",
        disabled && "cursor-not-allowed opacity-45",
      )}
      disabled={disabled}
      onClick={voiceInput.toggle}
      type="button"
    >
      {voiceInput.isListening ? (
        <Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
      ) : (
        <Mic aria-hidden="true" className="h-4 w-4" />
      )}
    </button>
  );
}

function SendActionButton({ canSubmit, isRunning }: { canSubmit: boolean; isRunning: boolean }) {
  return (
    <button
      aria-label={isRunning ? "Stop agent" : "Send message"}
      className={cn(
        "group relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full p-[2px] text-zinc-500 transition-colors hover:text-zinc-300",
        "bg-[conic-gradient(from_110deg,#09090b,#ffffff_16%,#3f3f46_32%,#09090b_54%,#ffffff_72%,#09090b)]",
        !canSubmit && !isRunning && "cursor-not-allowed opacity-45",
      )}
      disabled={!canSubmit && !isRunning}
      type="submit"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-[3px] rounded-full bg-gradient-to-b from-zinc-900 to-black shadow-[inset_0_2px_4px_rgba(255,255,255,0.05),inset_0_-2px_4px_rgba(0,0,0,0.3)]"
      />
      {isRunning ? (
        <Square
          aria-hidden="true"
          className="pointer-events-none relative z-10 h-3.5 w-3.5 fill-current"
        />
      ) : (
        <ArrowUp aria-hidden="true" className="pointer-events-none relative z-10 h-4 w-4" />
      )}
    </button>
  );
}

function ComposerStatusLine({ status, tone }: { status: null | string; tone: "error" | "ok" }) {
  if (!status) {
    return null;
  }
  return (
    <p
      aria-live="polite"
      className={cn(
        "px-4 pb-2 text-right font-mono text-[9px] uppercase tracking-[0.2em]",
        tone === "error" ? "text-red-300" : "text-zinc-600",
      )}
    >
      {status}
    </p>
  );
}

type AttachmentStatus = {
  text: string;
  tone: "error" | "ok";
};

function usePromptAttachments({
  currentValue,
  onChange,
}: {
  currentValue: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<AttachmentStatus | null>(null);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }
    let nextValue = currentValue;
    const attachedNames: string[] = [];
    try {
      for (const file of files.slice(0, 5)) {
        const attachment = await readPromptAttachment(file);
        nextValue = appendPromptAttachment(nextValue, attachment);
        attachedNames.push(attachment.name);
      }
      onChange(nextValue);
      setStatus({
        tone: "ok",
        text:
          attachedNames.length === 1
            ? `Attached ${attachedNames[0]}`
            : `Attached ${attachedNames.length} files`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not attach that file.",
      });
    }
  }

  return { inputRef, onFileChange, status };
}

interface VoiceInputState {
  isListening: boolean;
  isSupported: boolean;
  status: string | null;
  toggle: () => void;
  tone: "error" | "ok";
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionAlternative {
  confidence: number;
  transcript: string;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  abort: () => void;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

type SpeechWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

function useVoiceInput({
  currentValue,
  disabled,
  onChange,
}: {
  currentValue: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): VoiceInputState {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [tone, setTone] = useState<"error" | "ok">("ok");
  const baseTextRef = useRef("");
  const onChangeRef = useRef(onChange);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      setIsSupported(false);
      setStatus("Voice input unavailable in this browser");
      setTone("error");
      return;
    }
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let speechText = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? "";
        speechText += transcript;
      }
      const baseText = baseTextRef.current;
      onChangeRef.current(
        baseText && speechText ? `${baseText} ${speechText.trim()}` : speechText.trim(),
      );
    };
    recognition.onerror = (event) => {
      setIsListening(false);
      setTone("error");
      setStatus(voiceErrorMessage(event.error));
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    return () => {
      recognition.abort();
    };
  }, []);

  function toggle() {
    if (disabled || !isSupported || !recognitionRef.current) {
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      setTone("ok");
      setStatus("Voice input stopped");
      return;
    }
    try {
      baseTextRef.current = currentValue.trim();
      recognitionRef.current.start();
      setIsListening(true);
      setTone("ok");
      setStatus("Listening");
    } catch {
      setTone("error");
      setStatus("Voice input could not start");
    }
  }

  return { isListening, isSupported, status, toggle, tone };
}

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function voiceErrorMessage(error: string): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Microphone permission denied";
  }
  if (error === "no-speech") {
    return "No speech detected";
  }
  return "Voice input failed";
}

const BUDGET_OPTIONS: readonly { label: string; value: number | null }[] = [
  { label: "No cap", value: null },
  { label: "$2", value: 2 },
  { label: "$5", value: 5 },
  { label: "$10", value: 10 },
] as const;

const BUDGET_CAP_MAX_USD = 50;

function parseCustomBudget(raw: string): null | number {
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > BUDGET_CAP_MAX_USD) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

function BudgetCapControl({
  onChange,
  value,
}: {
  onChange: (value: number | null) => void;
  value: number | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const label = value === null ? "No cap" : `$${value}`;

  return (
    <div className="relative hidden sm:block">
      <button
        aria-expanded={isOpen}
        aria-label="Set run budget cap"
        className="flex h-8 items-center gap-1.5 rounded-md px-2 font-mono text-[10px] text-zinc-500 uppercase tracking-widest transition-colors hover:bg-zinc-800/40 hover:text-zinc-300"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <DollarSign aria-hidden="true" className="h-3.5 w-3.5" />
        <span>{label}</span>
      </button>
      {isOpen ? (
        <BudgetCapMenu
          onSelect={(next) => {
            onChange(next);
            setIsOpen(false);
          }}
          value={value}
        />
      ) : null}
    </div>
  );
}

function BudgetCapMenu({
  onSelect,
  value,
}: {
  onSelect: (value: number | null) => void;
  value: number | null;
}) {
  const isCustomValue = value !== null && BUDGET_OPTIONS.every((option) => option.value !== value);
  const [customDraft, setCustomDraft] = useState(isCustomValue ? String(value) : "");

  function commitCustom() {
    const parsed = parseCustomBudget(customDraft);
    if (parsed !== null) {
      onSelect(parsed);
    }
  }

  return (
    <div className="absolute right-0 bottom-10 z-30 w-36 border border-white/10 bg-[#09090b] p-1 shadow-2xl">
      {BUDGET_OPTIONS.map((option) => (
        <button
          className={cn(
            "flex h-8 w-full items-center justify-between px-2 font-mono text-[10px] uppercase tracking-widest transition-colors",
            option.value === value
              ? "bg-white/10 text-white"
              : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300",
          )}
          key={option.label}
          onClick={() => onSelect(option.value)}
          type="button"
        >
          <span>{option.label}</span>
          {option.value === value ? <span className="text-zinc-500">set</span> : null}
        </button>
      ))}
      <div
        className={cn(
          "flex h-8 w-full items-center gap-1 px-2",
          isCustomValue ? "bg-white/10" : undefined,
        )}
      >
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-widest",
            isCustomValue ? "text-white" : "text-zinc-500",
          )}
        >
          $
        </span>
        <input
          aria-label="Custom budget cap in dollars"
          className="w-full border-none bg-transparent font-mono text-[10px] text-white uppercase tracking-widest outline-none placeholder:text-zinc-600"
          inputMode="decimal"
          onBlur={commitCustom}
          onChange={(event) => setCustomDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitCustom();
            }
          }}
          placeholder="custom"
          value={customDraft}
        />
      </div>
    </div>
  );
}
