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
import {
  ComposerContextChips,
  composePromptWithComposerContext,
} from "@/components/composer/composer-context-chips";
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
type ComposerControlMenu = "budget" | "model";

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
  const [openControlMenu, setOpenControlMenu] = useState<ComposerControlMenu | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
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
    onInsert: (kind, item) => {
      if (kind === "slash") {
        setSelectedSkill(item.id);
      }
      emitComposerEvent(
        getToken,
        kind === "mention" ? "composer_mention_inserted" : "composer_slash_inserted",
      );
    },
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
      submitComposerValue();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (triggers.handleMenuKeyDown(event, menuItems)) {
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (canSubmit) {
        submitComposerValue();
      }
    }
    if (event.key === "Escape" && isRunning) {
      event.preventDefault();
      onStop();
    }
  }

  function submitComposerValue() {
    onSubmit(
      composePromptWithComposerContext({
        prompt: value,
        skill: selectedSkill,
        tool: null,
      }),
    );
    setSelectedSkill(null);
  }

  return (
    <form
      className="absolute right-0 bottom-0 left-0 z-10 bg-gradient-to-t from-white via-white/95 to-transparent pt-14 pb-10"
      onSubmit={handleSubmit}
    >
      <div className="relative z-10 mx-auto flex w-full max-w-[740px] flex-col justify-end px-3 sm:px-4">
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
            "bud-composer-shell w-full overflow-visible rounded-[24px] p-px",
            "transition-colors focus-within:border-[#eeeeee]",
          )}
        >
          <div className="bud-composer-fill flex min-h-[124px] flex-col justify-between rounded-[21px] px-2 pb-2">
            <div className="flex min-h-[80px] flex-col gap-1 px-0">
              <ComposerContextChips
                className="px-2 pt-3"
                onClearSkill={() => setSelectedSkill(null)}
                skill={selectedSkill}
                tool={null}
              />
              <div className="flex items-start gap-2">
                <label className="sr-only" htmlFor="prompt">
                  Message Cheatcode
                </label>
                <textarea
                  className={cn(
                    "max-h-[200px] min-h-[80px] w-full resize-none overflow-y-auto border-none bg-transparent px-2 pb-0 font-medium text-[#1b1b1b] text-[14px] leading-6 outline-none placeholder:text-[#a0a0a0]",
                    selectedSkill ? "pt-2" : "pt-4",
                  )}
                  id="prompt"
                  onChange={triggers.onTextareaChange}
                  onClick={triggers.onTextareaSelect}
                  onKeyDown={handleKeyDown}
                  onKeyUp={triggers.onTextareaSelect}
                  onSelect={triggers.onTextareaSelect}
                  placeholder="Reply, refine, or take the wheel"
                  ref={textareaRef}
                  rows={1}
                  value={value}
                />
              </div>
            </div>
            <div className="relative flex items-center justify-between gap-3 px-0">
              <div className="z-10 flex items-center gap-2">
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
                  className="paper-focus-ring flex h-7 w-7 items-center justify-center rounded-full text-[#707070] transition-colors hover:bg-white hover:text-[#1b1b1b]"
                  onClick={() => attachments.inputRef.current?.click()}
                  type="button"
                >
                  <Paperclip aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              <div className="z-10 flex items-center gap-2">
                <ModelMenu
                  onOpenChange={(open) => setOpenControlMenu(open ? "model" : null)}
                  open={openControlMenu === "model"}
                  variant="thread"
                />
                <BudgetCapControl
                  isOpen={openControlMenu === "budget"}
                  onChange={onBudgetChange}
                  onOpenChange={(open) => setOpenControlMenu(open ? "budget" : null)}
                  value={budgetCapUsd}
                />
                <VoiceInputButton isDisabled={isRunning} voiceInput={voiceInput} />
                <SendActionButton canSubmit={canSubmit} isRunning={isRunning} />
              </div>
            </div>
            <ComposerStatusLine status={composerStatus} tone={composerStatusTone} />
          </div>
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
        "hidden h-7 w-7 items-center justify-center rounded-full transition-colors sm:flex",
        voiceInput.isListening
          ? "bg-red-500/10 text-red-600"
          : "text-[#707070] hover:bg-white hover:text-[#1b1b1b]",
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
        "paper-focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1b1b1b] text-white transition-colors hover:bg-black",
        !canSubmit && !isRunning && "cursor-not-allowed bg-[#f1f1f1] text-[#a0a0a0]",
      )}
      disabled={!canSubmit && !isRunning}
      type="submit"
    >
      {isRunning ? (
        <Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
      ) : (
        <ArrowUp aria-hidden="true" className="h-4 w-4" />
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
        "px-2 pt-1 text-right text-[12px]",
        tone === "error" ? "text-red-600" : "text-[#707070]",
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
    try {
      const attachments = await Promise.all(files.slice(0, 5).map(readPromptAttachment));
      const attachedNames = attachments.map((attachment) => attachment.name);
      const nextValue = attachments.reduce(appendPromptAttachment, currentValue);
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
  isOpen,
  onChange,
  onOpenChange,
  value,
}: {
  isOpen: boolean;
  onChange: (value: number | null) => void;
  onOpenChange: (open: boolean) => void;
  value: number | null;
}) {
  const label = value === null ? "No cap" : `$${value}`;

  return (
    <div className="relative hidden sm:block">
      <button
        aria-expanded={isOpen}
        aria-label="Set run budget cap"
        className="flex h-7 items-center gap-1.5 rounded-full px-2 text-[#707070] text-[12px] transition-colors hover:bg-white hover:text-[#1b1b1b]"
        onClick={() => onOpenChange(!isOpen)}
        type="button"
      >
        <DollarSign aria-hidden="true" className="h-3.5 w-3.5" />
        <span>{label}</span>
      </button>
      {isOpen ? (
        <BudgetCapMenu
          onSelect={(next) => {
            onChange(next);
            onOpenChange(false);
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
    <div className="absolute right-0 bottom-10 z-30 w-36 rounded-2xl border border-[#f1f1f1] bg-white p-1 shadow-[0_18px_60px_rgba(0,0,0,0.12)]">
      {BUDGET_OPTIONS.map((option) => (
        <button
          className={cn(
            "flex h-8 w-full items-center justify-between rounded-xl px-2 text-[12px] transition-colors",
            option.value === value
              ? "bg-[#f7f7f7] text-[#1b1b1b]"
              : "text-[#707070] hover:bg-[#f7f7f7] hover:text-[#1b1b1b]",
          )}
          key={option.label}
          onClick={() => onSelect(option.value)}
          onPointerDown={(event) => {
            event.preventDefault();
            onSelect(option.value);
          }}
          type="button"
        >
          <span>{option.label}</span>
          {option.value === value ? <span className="text-[#a0a0a0]">set</span> : null}
        </button>
      ))}
      <div
        className={cn(
          "flex h-8 w-full items-center gap-1 px-2",
          isCustomValue ? "rounded-xl bg-[#f7f7f7]" : undefined,
        )}
      >
        <span className={cn("text-[12px]", isCustomValue ? "text-[#1b1b1b]" : "text-[#707070]")}>
          $
        </span>
        <input
          aria-label="Custom budget cap in dollars"
          className="w-full border-none bg-transparent text-[#1b1b1b] text-[12px] outline-none placeholder:text-[#a0a0a0]"
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
