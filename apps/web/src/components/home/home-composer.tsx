"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  ChevronDown,
  Code,
  DollarSign,
  Globe,
  Heart,
  Palette,
  Paperclip,
  Smartphone,
  Sparkles,
  Star,
  TrendingUp,
  X,
  Zap,
} from "@/components/ui/icons";
import { agentModelLabel, agentModelRequestValue } from "@/lib/agent-models";
import {
  appendPromptAttachment,
  PROMPT_ATTACHMENT_ACCEPT,
  readPromptAttachment,
} from "@/lib/input/prompt-attachments";
import { createPromptHandoff } from "@/lib/input/prompt-handoff";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

type PromptExample = {
  icon: typeof Code;
  title: string;
  query: string;
};

type IntentId = "automation" | "data" | "mobile-app" | "research" | "slides" | "web-app";

type Intent = {
  icon: typeof Code;
  id: IntentId;
  label: string;
  placeholder: string;
  skill: null | string;
  surface: "mobile" | "web" | null;
};

const INTENTS: readonly Intent[] = [
  {
    icon: Smartphone,
    id: "mobile-app",
    label: "Mobile app",
    placeholder: "Describe the app — I'll build it with a live phone preview",
    skill: null,
    surface: "mobile",
  },
  {
    icon: Globe,
    id: "web-app",
    label: "Web app",
    placeholder: "Describe the site or web app — I'll build and preview it",
    skill: null,
    surface: "web",
  },
  {
    icon: Star,
    id: "slides",
    label: "Slides",
    placeholder: "What's the deck about? Audience and key points help",
    skill: "pitch-deck",
    surface: null,
  },
  {
    icon: Sparkles,
    id: "research",
    label: "Research",
    placeholder: "What should I research? I'll fan out agents and cite sources",
    skill: "deep-research",
    surface: null,
  },
  {
    icon: TrendingUp,
    id: "data",
    label: "Data",
    placeholder: "Attach or describe the data — I'll profile and chart it",
    skill: "csv-analyst",
    surface: null,
  },
  {
    icon: Zap,
    id: "automation",
    label: "Automation",
    placeholder: "Describe the trigger and the action — every morning, when X happens…",
    skill: null,
    surface: null,
  },
] as const;

const WEB_PROMPTS: PromptExample[] = [
  {
    icon: Code,
    title: "AI startup landing page",
    query:
      "build a simple AI startup landing page with hero, features, pricing, and waitlist signup",
  },
  {
    icon: Palette,
    title: "Creative portfolio website",
    query: "build a simple creative portfolio website with gallery, case studies, and contact form",
  },
  {
    icon: TrendingUp,
    title: "Crypto trading dashboard",
    query: "build a simple crypto trading dashboard with live charts and portfolio view",
  },
  {
    icon: DollarSign,
    title: "Personal finance tracker",
    query: "build a simple personal finance tracker with budgets, expenses, and charts",
  },
  {
    icon: Heart,
    title: "Mental wellness app",
    query: "build a simple mental wellness app with mood tracking, meditation, and journal",
  },
];

const MOBILE_PROMPTS: PromptExample[] = [
  {
    icon: TrendingUp,
    title: "Run Tracker",
    query: "build a simple run tracker app with start/stop, distance, and run history",
  },
  {
    icon: DollarSign,
    title: "Calorie Tracker",
    query: "build a simple calorie tracker with meals, daily targets, and progress",
  },
  {
    icon: Code,
    title: "Pomodoro Timer",
    query: "build a simple pomodoro timer with work/break cycles and stats",
  },
  {
    icon: DollarSign,
    title: "Financial management app",
    query: "build a simple financial management app with budgets, expenses, and charts",
  },
  {
    icon: TrendingUp,
    title: "Stocks management app",
    query: "build a simple stocks management app with watchlist and portfolio",
  },
];

const SLIDES_PROMPTS: PromptExample[] = [
  {
    icon: Star,
    title: "Seed pitch deck",
    query: "turn my seed-round notes into a 12-slide investor deck with speaker notes",
  },
  {
    icon: Code,
    title: "Product launch deck",
    query: "create a product launch deck for an AI support copilot with demo flow and pricing",
  },
  {
    icon: TrendingUp,
    title: "Quarterly review",
    query: "build a quarterly business review deck from these growth and retention numbers",
  },
];

const RESEARCH_PROMPTS: PromptExample[] = [
  {
    icon: Sparkles,
    title: "Competitor scan",
    query: "scan the top 20 AI app-builder startups and brief me on positioning and pricing",
  },
  {
    icon: TrendingUp,
    title: "Market sizing",
    query: "size the market for voice AI agents in India with cited sources",
  },
  {
    icon: Code,
    title: "Technical due diligence",
    query: "research how production teams run browser agents and summarize the tradeoffs",
  },
];

const DATA_PROMPTS: PromptExample[] = [
  {
    icon: TrendingUp,
    title: "Retention analysis",
    query: "analyze my weekly signups CSV and chart activation and day-7 retention",
  },
  {
    icon: DollarSign,
    title: "Revenue breakdown",
    query: "profile this revenue export and break it down by plan, geography, and month",
  },
  {
    icon: Code,
    title: "Funnel drop-off",
    query: "find the biggest drop-off in this onboarding events file and chart it",
  },
];

const AUTOMATION_PROMPTS: PromptExample[] = [
  {
    icon: Zap,
    title: "Morning digest",
    query: "every morning at 8, draft a social post pack from our latest changelog",
  },
  {
    icon: Code,
    title: "Nightly build report",
    query: "when the nightly build finishes, summarize what changed and post the digest to Slack",
  },
  {
    icon: TrendingUp,
    title: "Inbox triage",
    query: "go through my Gmail for bug reports and turn them into Linear tickets",
  },
];

const INTENT_PROMPTS: Record<IntentId, PromptExample[]> = {
  automation: AUTOMATION_PROMPTS,
  data: DATA_PROMPTS,
  "mobile-app": MOBILE_PROMPTS,
  research: RESEARCH_PROMPTS,
  slides: SLIDES_PROMPTS,
  "web-app": WEB_PROMPTS,
};

const TYPEWRITER_SENTENCES = [
  "Automate my client onboarding flow and generate a progress report",
  "Build a landing page",
  "Create a mobile app",
  "Fix a bug",
] as const;

export function HomeComposer() {
  const router = useRouter();
  const agentModelId = useAppStore((state) => state.agentModelId);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [intentId, setIntentId] = useState<IntentId | null>(null);
  const [attachmentStatus, setAttachmentStatus] = useState<AttachmentStatus | null>(null);
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const typewriterPlaceholder = useTypewriterPlaceholder();
  const intent = INTENTS.find((candidate) => candidate.id === intentId) ?? null;
  const placeholder = intent ? intent.placeholder : typewriterPlaceholder;
  const prompts = intent ? INTENT_PROMPTS[intent.id] : WEB_PROMPTS;
  const canSubmit = value.trim().length > 0;
  const modelLabel = agentModelLabel(agentModelId);

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!canSubmit) {
      return;
    }
    const trimmed = value.trim();
    const prompt =
      intent?.skill && !trimmed.startsWith("/") ? `/${intent.skill} ${trimmed}` : trimmed;
    startPrompt(prompt, intent ? intent.surface : "web");
  }

  function toggleIntent(nextId: IntentId) {
    setIntentId((current) => (current === nextId ? null : nextId));
  }

  function clearIntent() {
    setIntentId(null);
    textareaRef.current?.focus();
  }

  function startPrompt(prompt: string, surface: "mobile" | "web" | null) {
    const params = buildLaunchParams({
      model: agentModelRequestValue(agentModelId) ?? null,
      prompt,
      surface,
    });
    router.push(`/projects?${params.toString()}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) {
      event.preventDefault();
      submit();
    }
  }

  async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }
    const attachedNames: string[] = [];
    try {
      const attachments: Awaited<ReturnType<typeof readPromptAttachment>>[] = [];
      for (const file of files.slice(0, 5)) {
        const attachment = await readPromptAttachment(file);
        attachments.push(attachment);
        attachedNames.push(attachment.name);
      }
      setValue((current) => attachments.reduce(appendPromptAttachment, current));
      setAttachmentStatus({
        tone: "ok",
        text:
          attachedNames.length === 1
            ? `Attached ${attachedNames[0]}`
            : `Attached ${attachedNames.length} files`,
      });
    } catch (error) {
      setAttachmentStatus({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not attach that file.",
      });
    }
  }

  return (
    <div className="w-full">
      <fieldset className="mx-auto mb-4 flex w-full max-w-3xl flex-wrap justify-center gap-2">
        <legend className="sr-only">What do you want to make?</legend>
        {INTENTS.map((candidate) => {
          const Icon = candidate.icon;
          const isActive = candidate.id === intentId;
          return (
            <button
              aria-pressed={isActive}
              className={cn(
                "flex h-8 items-center gap-2 border px-3 font-mono text-[10px] uppercase tracking-widest transition-all",
                isActive
                  ? "border-white/25 bg-white/10 text-white shadow-[0_0_10px_rgba(255,255,255,0.08)]"
                  : "border-white/5 bg-[#09090b] text-zinc-500 hover:border-white/10 hover:text-zinc-300",
              )}
              key={candidate.id}
              onClick={() => toggleIntent(candidate.id)}
              type="button"
            >
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{candidate.label}</span>
            </button>
          );
        })}
      </fieldset>
      <form className="relative w-full" onSubmit={submit}>
        <div
          className={cn(
            "mx-auto w-full max-w-3xl overflow-hidden rounded-none border border-white/5 bg-[#09090b]",
            "shadow-[0_20px_50px_-12px_rgba(0,0,0,1),inset_0_1px_0_rgba(255,255,255,0.15)]",
            "transition-colors focus-within:border-white/10",
          )}
        >
          <div className="px-4 pt-6">
            <label className="sr-only" htmlFor="home-prompt">
              Message Cheatcode
            </label>
            <textarea
              className="max-h-[200px] min-h-12 w-full resize-none overflow-y-auto border-none bg-transparent p-0 pb-4 font-mono text-[16px] text-white/90 caret-blue-500 outline-none placeholder:text-zinc-600"
              id="home-prompt"
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              ref={textareaRef}
              rows={1}
              value={value}
            />
          </div>
          <div className="flex items-center justify-between px-4 pt-2 pb-4">
            <div className="flex items-center gap-2">
              <input
                accept={PROMPT_ATTACHMENT_ACCEPT}
                className="sr-only"
                multiple
                onChange={handleAttachmentChange}
                ref={attachmentInputRef}
                tabIndex={-1}
                type="file"
              />
              <button
                aria-label="Attach file"
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-none border border-white/5",
                  "bg-gradient-to-b from-[#333] to-[#1a1a1a] text-zinc-400",
                  "shadow-[0_1px_2px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]",
                  "transition-all hover:from-[#3a3a3a] hover:to-[#222] hover:text-white",
                )}
                onClick={() => attachmentInputRef.current?.click()}
                type="button"
              >
                <Paperclip aria-hidden="true" className="h-4 w-4" />
              </button>
              {intent ? (
                <div className="flex h-8 items-center gap-2 border border-white/15 bg-white/5 px-3 font-mono text-[10px] text-zinc-200 uppercase tracking-widest">
                  <intent.icon aria-hidden="true" className="h-3.5 w-3.5" />
                  <span>{intent.label}</span>
                  <button
                    aria-label={`Clear ${intent.label} intent`}
                    className="-mr-1.5 ml-0.5 flex h-6 w-6 items-center justify-center text-zinc-500 transition-colors hover:text-white"
                    onClick={clearIntent}
                    type="button"
                  >
                    <X aria-hidden="true" className="h-3 w-3" />
                  </button>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Link
                aria-label={modelLabel}
                className={cn(
                  "mr-2 hidden h-10 items-center gap-2 rounded-none border border-white/5 px-3",
                  "bg-gradient-to-b from-[#333] to-[#1a1a1a] font-mono text-[10px] text-zinc-400 uppercase tracking-widest",
                  "shadow-[0_1px_2px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]",
                  "transition-all hover:from-[#3a3a3a] hover:to-[#222] hover:text-white md:flex",
                )}
                href="/settings/agents"
              >
                <span className="font-bold text-white text-xs">AI</span>
                <span>{modelLabel}</span>
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
              <button
                aria-label="Send message"
                className={cn(
                  "group relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full p-[2px] text-zinc-400 transition-all hover:text-white",
                  "bg-[conic-gradient(from_110deg,#09090b,#ffffff_16%,#3f3f46_32%,#09090b_54%,#ffffff_72%,#09090b)]",
                  !canSubmit && "cursor-not-allowed opacity-50",
                )}
                disabled={!canSubmit}
                onClick={() => submit()}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-[3px] rounded-full bg-gradient-to-b from-zinc-900 to-black shadow-[inset_0_2px_4px_rgba(255,255,255,0.05),inset_0_-2px_4px_rgba(0,0,0,0.3)]"
                />
                <ArrowUp aria-hidden="true" className="pointer-events-none relative z-10 h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="h-10 border-white/[0.05] border-t bg-[#121212] bg-[radial-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:4px_4px]" />
        </div>
        <div className="absolute top-1/2 -left-4 h-px w-4 bg-zinc-800/50" />
        <div className="absolute top-1/2 -right-4 h-px w-4 bg-zinc-800/50" />
      </form>
      {attachmentStatus ? (
        <p
          aria-live="polite"
          className={cn(
            "mx-auto mt-3 max-w-3xl text-center font-mono text-[10px] uppercase tracking-[0.22em]",
            attachmentStatus.tone === "error" ? "text-red-300" : "text-zinc-500",
          )}
        >
          {attachmentStatus.text}
        </p>
      ) : null}
      <div className="mx-auto w-full max-w-4xl px-4 pt-10">
        <div className="flex flex-wrap justify-center gap-2 py-2">
          {prompts.map((prompt) => {
            const Icon = prompt.icon;
            return (
              <button
                className={cn(
                  "h-fit w-fit rounded-none border border-white/5 bg-[#09090b] px-4 py-2.5",
                  "font-medium font-mono text-[11px] text-zinc-400 uppercase tracking-wider",
                  "shadow-[0_1px_2px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)]",
                  "transition-all hover:border-white/10 hover:bg-[#121212] hover:text-white",
                )}
                key={prompt.title}
                onClick={() => setValue(prompt.query)}
                type="button"
              >
                <span className="flex items-center gap-3">
                  <Icon
                    aria-hidden="true"
                    className="h-4 w-4 opacity-50 grayscale transition-all"
                  />
                  <span className="whitespace-nowrap">{prompt.title}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type AttachmentStatus = {
  text: string;
  tone: "error" | "ok";
};

function buildLaunchParams(input: {
  model: null | string;
  prompt: string;
  surface: "mobile" | "web" | null;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (input.prompt.length > 0) {
    const promptHandoff = createPromptHandoff(input.prompt);
    if (promptHandoff.prompt) {
      params.set("prompt", promptHandoff.prompt);
    }
    if (promptHandoff.promptKey) {
      params.set("promptKey", promptHandoff.promptKey);
    }
  }
  if (input.surface) {
    params.set("surface", input.surface);
  }
  if (input.model) {
    params.set("model", input.model);
  }
  return params;
}

function useTypewriterPlaceholder() {
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
          const nextIndex = charIndex + 1;
          setCharIndex(nextIndex);
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
