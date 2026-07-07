"use client";

import { gatewayRequestUrl } from "@cheatcode/api-client";
import { env } from "@cheatcode/env/web";
import {
  type IntegrationName,
  type ProjectSummary,
  SandboxUsageSummaryResponseSchema,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { AuthModal } from "@/components/auth/auth-modal";
import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import { AddMenu } from "@/components/composer/add-menu";
import {
  ComposerContextChips,
  composePromptWithComposerContext,
} from "@/components/composer/composer-context-chips";
import { ComposerPopover } from "@/components/composer/composer-popover";
import { ModelMenu } from "@/components/composer/model-menu";
import { ProjectPicker } from "@/components/composer/project-picker";
import { slashSkillItems } from "@/components/composer/slash-skill-source";
import {
  type TriggerDetector,
  useComposerTriggers,
} from "@/components/composer/use-composer-triggers";
import { resolveInitialSkill, skillSurface } from "@/components/home/use-initial-skill";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { ArrowUp, Globe, Smartphone, Star, TrendingUp, X, Zap } from "@/components/ui/icons";
import { agentModelRequestValue } from "@/lib/agent-models";
import { buildExistingProjectParams, launchIntoProject } from "@/lib/api/home-launch";
import { createChat, surfaceToMode, threadTitle } from "@/lib/api/project-thread";
import { listUserSkills, USER_SKILLS_QUERY } from "@/lib/api/skills";
import { detectSlashToken } from "@/lib/input/caret-tokens";
import {
  appendPromptAttachment,
  PROMPT_ATTACHMENT_ACCEPT,
  readPromptAttachment,
} from "@/lib/input/prompt-attachments";
import { consumePromptHandoff, createPromptHandoff } from "@/lib/input/prompt-handoff";
import { useAppStore } from "@/lib/store/app-store";
import { emitComposerEvent } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";

const SLASH_DETECTOR: TriggerDetector = { detect: detectSlashToken, kind: "slash" };
const SLASH_SOURCES: readonly TriggerDetector[] = [SLASH_DETECTOR];

type IntentId = "automation" | "data" | "mobile-app" | "research" | "slides" | "web-app";

type Intent = {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "false" | "true" }>;
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
    placeholder: "Describe the app - I'll build it with a live phone preview",
    skill: null,
    surface: "mobile",
  },
  {
    icon: Globe,
    id: "web-app",
    label: "Web app",
    placeholder: "Describe the site or web app - I'll build and preview it",
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
    icon: CheatcodeMark,
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
    placeholder: "Attach or describe the data - I'll profile and chart it",
    skill: "csv-analyst",
    surface: null,
  },
  {
    icon: Zap,
    id: "automation",
    label: "Automation",
    placeholder: "Describe the trigger and the action - every morning, when X happens...",
    skill: null,
    surface: null,
  },
] as const;

const QUICK_ACTION_PRIMARY_INTENTS = INTENTS.slice(0, 2);
const QUICK_ACTION_SECONDARY_INTENTS = INTENTS.slice(2);

const TYPEWRITER_SENTENCES = [
  "Automate my client onboarding flow and generate a progress report",
  "Build a landing page",
  "Create a mobile app",
  "Fix a bug",
] as const;

/** The skill to attach on submit — a repo import carries no skill. */
function resolveSubmitSkill(
  repoUrl: string | null,
  intent: Intent | null,
  skillChip: string | null,
): string | null {
  if (repoUrl) {
    return null;
  }
  return intent?.skill ?? skillChip;
}

/** The build surface (mobile/web/null) implied by the current intent or imported repo. */
function resolveSubmitSurface(
  repoUrl: string | null,
  intentId: IntentId | null,
  intent: Intent | null,
  skillChip: string | null,
): "mobile" | "web" | null {
  if (repoUrl) {
    return intentId === "mobile-app" ? "mobile" : "web";
  }
  return intent ? intent.surface : skillSurface(skillChip);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: large composer whose score comes from idiomatic JSX conditionals (intent/repo/skill-creator chips); pre-existing, splitting the JSX risks visual regressions.
export function HomeComposer({
  initialPrompt,
  initialPromptKey,
  initialSkill,
  initialTool,
  skillCreator = false,
}: {
  initialPrompt?: string | undefined;
  initialPromptKey?: string | undefined;
  initialSkill?: string | undefined;
  initialTool?: IntegrationName | undefined;
  skillCreator?: boolean | undefined;
}) {
  const initial = useMemo(() => resolveInitialSkill(initialSkill ?? null), [initialSkill]);
  const handoffPrompt = usePromptHandoff(initialPromptKey);
  const router = useRouter();
  const { getToken: getAuthToken } = useAuth();
  const getToken = useCallback(() => resolveComposerAuthToken(getAuthToken), [getAuthToken]);
  const agentModelId = useAppStore((state) => state.agentModelId);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [intentId, setIntentId] = useState<IntentId | null>(initial.intent);
  const [skillChip, setSkillChip] = useState<string | null>(initial.chip);
  const [toolChip, setToolChip] = useState<IntegrationName | null>(initialTool ?? null);
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const [attachmentStatus, setAttachmentStatus] = useState<AttachmentStatus | null>(null);
  const [value, setValue] = useState(initialPrompt ?? "");
  const [skillCreatorMode, setSkillCreatorMode] = useState(skillCreator);
  const [authRedirectTo, setAuthRedirectTo] = useState<string | null>(null);
  // In-flight submit guard: without it, rapid double/triple clicks fire multiple createChat
  // calls → duplicate threads in the sidebar. The ref blocks re-entry synchronously (setState
  // is async); the state also disables the button. Only the non-navigating paths reset it —
  // a successful submit navigates away and unmounts this component.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const endSubmitting = useCallback(() => {
    submittingRef.current = false;
    setIsSubmitting(false);
  }, []);
  const typewriterPlaceholder = useTypewriterPlaceholder();
  const intent = INTENTS.find((candidate) => candidate.id === intentId) ?? null;
  const placeholder = intent ? intent.placeholder : typewriterPlaceholder;
  const canSubmit = value.trim().length > 0 && !isSubmitting;
  const { data: userSkills } = useQuery({
    queryFn: () => listUserSkills(getToken),
    queryKey: USER_SKILLS_QUERY,
    staleTime: 60_000,
  });
  const triggers = useComposerTriggers({
    onChange: setValue,
    onInsert: (_kind, item) => {
      selectSkill(item.id);
      emitComposerEvent(getToken, "composer_slash_inserted");
    },
    sources: SLASH_SOURCES,
    textareaRef,
    value,
  });
  const slashItems = slashSkillItems(triggers.query, userSkills ?? []);
  const isMenuOpen = triggers.kind === "slash" && triggers.isActive && slashItems.length > 0;

  useEffect(() => {
    const nextPrompt = handoffPrompt ?? initialPrompt;
    if (!nextPrompt) {
      return;
    }
    setValue((current) => (current.length > 0 ? current : nextPrompt));
  }, [handoffPrompt, initialPrompt]);

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!canSubmit || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    const trimmed = value.trim();
    const skill = resolveSubmitSkill(repoUrl, intent, skillChip);
    const prompt = composePromptWithComposerContext({
      prompt: trimmed,
      skill,
      tool: toolChip,
    });
    if (selectedProject) {
      void launchExisting(selectedProject, prompt);
      return;
    }
    void startPrompt(prompt, resolveSubmitSurface(repoUrl, intentId, intent, skillChip));
  }

  async function launchExisting(project: ProjectSummary, prompt: string) {
    try {
      const result = await launchIntoProject(getToken, project.id, prompt);
      if (result.busy) {
        toast.error(
          "That project's latest thread is busy - wait for the run to finish or pick another project.",
        );
        endSubmitting();
        return;
      }
      const handoff = buildExistingProjectParams(prompt).toString();
      router.push(`/chats/${encodeURIComponent(result.threadId)}?${handoff}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open that project.");
      endSubmitting();
    }
  }

  function toggleIntent(nextId: IntentId) {
    const nextIntent = INTENTS.find((candidate) => candidate.id === nextId) ?? null;
    const isClearing = intentId === nextId;
    setIntentId(isClearing ? null : nextId);
    setSkillChip(isClearing ? null : (nextIntent?.skill ?? null));
    if (repoUrl && nextId !== "mobile-app" && nextId !== "web-app") {
      setRepoUrl(null);
    }
  }

  function clearIntent() {
    if (intent?.skill && skillChip === intent.skill) {
      setSkillChip(null);
    }
    setIntentId(null);
    textareaRef.current?.focus();
  }

  function selectSkill(skill: string) {
    const nextInitial = resolveInitialSkill(skill);
    setIntentId(nextInitial.intent);
    setSkillChip(nextInitial.chip);
    setRepoUrl(null);
  }

  function clearSkillSelection() {
    if (intent?.skill && skillChip === intent.skill) {
      setIntentId(null);
    }
    setSkillChip(null);
    textareaRef.current?.focus();
  }

  function selectQuickIntent(nextId: IntentId) {
    toggleIntent(nextId);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleRepoAttach(url: string) {
    setRepoUrl(url);
    setSkillChip(null);
    if (intentId !== "mobile-app" && intentId !== "web-app") {
      setIntentId(null);
    }
  }

  function handleSelectProject(project: ProjectSummary | null) {
    setSelectedProject(project);
    if (project) {
      setRepoUrl(null);
    }
  }

  async function startPrompt(prompt: string, surface: "mobile" | "web" | null) {
    const model = agentModelRequestValue(agentModelId) ?? null;
    const token = await getToken();
    if (!token) {
      // Unauthenticated: open sign-in in place and preserve the typed prompt across
      // auth via the URL handoff, landing back on home (no API call without a token).
      // Once signed in the prompt is restored in the composer and submitted as an
      // authenticated chat create.
      const params = buildLaunchParams({ model, prompt, repo: repoUrl, surface });
      setAuthRedirectTo(`/?${params.toString()}`);
      endSubmitting();
      return;
    }
    try {
      const thread = await createChat(getToken, {
        initialPrompt: prompt,
        title: threadTitle(prompt),
        mode: surfaceToMode(surface),
        ...(repoUrl ? { importRepoUrl: repoUrl } : {}),
        ...(model ? { defaultModel: model } : {}),
      });
      const handoff = buildExistingProjectParams(prompt).toString();
      router.push(`/chats/${encodeURIComponent(thread.id)}?${handoff}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start that chat.");
      endSubmitting();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (triggers.handleMenuKeyDown(event, slashItems)) {
      return;
    }
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
    try {
      const attachments = await Promise.all(files.slice(0, 5).map(readPromptAttachment));
      const attachedNames = attachments.map((attachment) => attachment.name);
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
    <div className="mt-6 w-full">
      <HomeQuickActions activeIntentId={intentId} onIntentClick={selectQuickIntent} />
      {skillCreatorMode ? <SkillCreatorSuggestions onPick={(text) => setValue(text)} /> : null}
      <form
        className="cheatcode-home-composer-form mt-8 w-full md:pointer-events-none md:fixed md:right-0 md:bottom-8 md:left-0 md:z-20 md:flex md:justify-center md:pl-64"
        onSubmit={submit}
      >
        <div className="relative z-10 mx-auto flex w-full max-w-[708px] flex-col gap-0 md:pointer-events-auto">
          <FreePlanComposerBanner getToken={getToken} />
          <div
            className={cn(
              "bud-composer-shell cheatcode-home-composer-shell relative w-full rounded-[24px] p-px",
              "transition-colors focus-within:border-[#e4e4e4]",
            )}
          >
            {isMenuOpen ? (
              <ComposerPopover
                activeIndex={triggers.activeIndex}
                ariaLabel="Skills"
                items={slashItems}
                onHoverIndex={triggers.setActiveIndex}
                onSelectIndex={(index) => triggers.commitIndex(index, slashItems)}
              />
            ) : null}
            <div className="bud-composer-fill flex min-h-[124px] flex-col justify-between rounded-[21px] px-2 pb-2">
              <div>
                {skillCreatorMode ? (
                  <div className="px-3 pt-3">
                    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-black/[0.06] bg-[#f5f5f5] py-0.5 pr-1 pl-2.5 font-medium text-[#1b1b1b] text-[13px]">
                      <CheatcodeMark
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 text-[#a9842e]"
                      />
                      Skill Creator
                      <button
                        aria-label="Exit Skill Creator"
                        className="flex h-5 w-5 items-center justify-center rounded-full text-[#8a8a8a] transition-colors hover:bg-black/[0.04] hover:text-[#1b1b1b]"
                        onClick={() => setSkillCreatorMode(false)}
                        type="button"
                      >
                        <X aria-hidden="true" className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                ) : null}
                <ComposerContextChips
                  className="px-2 pt-3"
                  onClearSkill={clearSkillSelection}
                  onClearTool={() => setToolChip(null)}
                  skill={skillChip}
                  tool={toolChip}
                />
                <label className="sr-only" htmlFor="home-prompt">
                  Message Cheatcode
                </label>
                <textarea
                  className={cn(
                    "max-h-[200px] min-h-[80px] w-full resize-none overflow-y-auto border-none bg-transparent px-2 pb-0 font-medium text-[#1b1b1b] text-[14px] leading-6 outline-none placeholder:text-[#a0a0a0]",
                    skillChip || toolChip || skillCreatorMode ? "pt-2" : "pt-4",
                  )}
                  id="home-prompt"
                  onChange={triggers.onTextareaChange}
                  onClick={triggers.onTextareaSelect}
                  onKeyDown={handleKeyDown}
                  onKeyUp={triggers.onTextareaSelect}
                  onSelect={triggers.onTextareaSelect}
                  placeholder={placeholder}
                  ref={textareaRef}
                  rows={1}
                  value={value}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-hidden="true"
                    accept={PROMPT_ATTACHMENT_ACCEPT}
                    className="sr-only"
                    multiple
                    onChange={handleAttachmentChange}
                    ref={attachmentInputRef}
                    tabIndex={-1}
                    type="file"
                  />
                  <AddMenu
                    allowRepoImport={selectedProject === null}
                    onRepoAttach={handleRepoAttach}
                    onUploadClick={() => attachmentInputRef.current?.click()}
                  />
                  <ProjectPicker onSelect={handleSelectProject} selectedProject={selectedProject} />
                  {intent ? (
                    <div className="flex h-8 items-center gap-2 rounded-full bg-white px-3 text-[#1b1b1b] text-[12px] shadow-[0_0_1px_rgba(0,0,0,0.08),inset_0_0_2px_rgba(0,0,0,0.02)]">
                      <intent.icon aria-hidden="true" className="h-3.5 w-3.5" />
                      <span>{intent.label}</span>
                      <button
                        aria-label={`Clear ${intent.label} intent`}
                        className="-mr-1.5 ml-0.5 flex h-6 w-6 items-center justify-center text-[#8a8a8a] transition-colors hover:text-[#1b1b1b]"
                        onClick={clearIntent}
                        type="button"
                      >
                        <X aria-hidden="true" className="h-3 w-3" />
                      </button>
                    </div>
                  ) : null}
                  {repoUrl ? (
                    <RemovableChip
                      label={repoLabel(repoUrl)}
                      onClear={() => setRepoUrl(null)}
                      title={repoUrl}
                    />
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <ModelMenu variant="home" />
                  <button
                    aria-label="Send message"
                    className={cn(
                      "paper-focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                      canSubmit
                        ? "bg-[#1b1b1b] text-white hover:bg-black"
                        : "cursor-not-allowed bg-[#f1f1f1] text-[#8a8a8a]",
                    )}
                    disabled={!canSubmit}
                    onClick={() => submit()}
                    type="button"
                  >
                    <ArrowUp aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
      {attachmentStatus ? (
        <p
          aria-live="polite"
          className={cn(
            "mx-auto mt-3 max-w-[448px] text-center text-[12px]",
            attachmentStatus.tone === "error" ? "text-red-600" : "text-[#707070]",
          )}
        >
          {attachmentStatus.text}
        </p>
      ) : null}
      {authRedirectTo ? (
        <AuthModal
          mode="sign-up"
          onClose={() => setAuthRedirectTo(null)}
          open={true}
          redirectTo={authRedirectTo}
        />
      ) : null}
    </div>
  );
}

type AttachmentStatus = {
  text: string;
  tone: "error" | "ok";
};

const SKILL_CREATOR_SUGGESTIONS = [
  "Create a skill that drafts follow-up emails from meeting notes",
  "Create a skill that summarizes Linear issues",
  "Create a skill that turns screenshots into bug reports",
  "Create a skill that researches a company before sales calls",
] as const;

function SkillCreatorSuggestions({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mx-auto mt-6 w-full max-w-[448px] rounded-[17px] border border-[#f1f1f1] bg-white p-1.5">
      <p className="px-2 pt-1 pb-1 font-medium text-[#a0a0a0] text-[12px]">Create skills</p>
      <ul>
        {SKILL_CREATOR_SUGGESTIONS.map((suggestion) => (
          <li key={suggestion}>
            <button
              className="flex w-full items-center gap-2.5 rounded-[11px] px-2 py-1.5 text-left font-medium text-[#1b1b1b] text-[13px] leading-5 transition-colors hover:bg-[#f7f7f7]"
              onClick={() => onPick(suggestion)}
              type="button"
            >
              <CheatcodeMark aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#a0a0a0]" />
              <span className="min-w-0 flex-1 truncate">{suggestion}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HomeQuickActions({
  activeIntentId,
  onIntentClick,
}: {
  activeIntentId: IntentId | null;
  onIntentClick: (intentId: IntentId) => void;
}) {
  return (
    <div className="paper-soft-panel mx-auto flex w-full max-w-[448px] flex-col gap-1 overflow-hidden rounded-[17px] p-1">
      <div className="grid w-full grid-cols-2 gap-1">
        {QUICK_ACTION_PRIMARY_INTENTS.map((intent) => (
          <HomeQuickAction
            active={activeIntentId === intent.id}
            icon={intent.icon}
            key={intent.id}
            label={intent.label}
            onClick={() => onIntentClick(intent.id)}
          />
        ))}
      </div>
      <div className="grid w-full grid-cols-2 gap-1 sm:grid-cols-4">
        {QUICK_ACTION_SECONDARY_INTENTS.map((intent) => (
          <HomeQuickAction
            active={activeIntentId === intent.id}
            icon={intent.icon}
            key={intent.id}
            label={intent.label}
            onClick={() => onIntentClick(intent.id)}
          />
        ))}
      </div>
    </div>
  );
}

function HomeQuickAction({
  active = false,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "false" | "true" }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active ? true : undefined}
      className={cn(
        "paper-focus-ring bud-lifted-surface flex h-8 min-w-0 items-center justify-center gap-1 rounded-full px-1.5 font-medium text-[#1b1b1b] text-[12px] leading-[18px] transition-colors hover:bg-[#f7f7f7] sm:gap-1.5 sm:px-2 sm:text-[13px] sm:leading-[19.5px]",
        active ? "bg-[#f7f7f7] shadow-[inset_0_0_0_1px_rgba(27,27,27,0.04)]" : null,
      )}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#4f4f4f]" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

type ClerkBrowserSession = {
  session?: {
    getToken?: () => Promise<null | string>;
    lastActiveToken?: {
      getRawString?: () => string;
    };
  };
};

async function resolveComposerAuthToken(
  getAuthToken: () => Promise<null | string>,
): Promise<null | string> {
  const browserSession = (window as Window & { Clerk?: ClerkBrowserSession }).Clerk?.session;
  const rawToken = browserSession?.lastActiveToken?.getRawString?.();
  if (rawToken) {
    return rawToken;
  }
  const browserToken = browserSession?.getToken
    ? await Promise.race([browserSession.getToken(), wait(500).then(() => null)])
    : null;
  if (browserToken) {
    return browserToken;
  }
  return Promise.race([getAuthToken(), wait(300).then(() => null)]);
}

function FreePlanComposerBanner({ getToken }: { getToken: () => Promise<null | string> }) {
  const tier = useComposerUsageTier();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (tier && tier !== "free") {
    return null;
  }

  return (
    <div className="mx-auto -mb-2 w-full max-w-[96%]">
      <div className="overflow-hidden rounded-t-[20px] border-2 border-[#f1f1f1] border-b-0 bg-white">
        <div className="rounded-t-[18px] bg-white p-0.5 pb-1.5">
          <div className="rounded-t-[16px] bg-gradient-to-b from-[#f7f7f7] to-transparent">
            <div className="flex items-center gap-3 px-3 pt-2 pb-2.5">
              <span className="min-w-0 flex-1 truncate font-medium text-[#1b1b1b] text-[13px] leading-[19.5px]">
                Choose a plan or add credits to start building
              </span>
              <button
                className="shrink-0 font-medium text-[#5f5f5f] text-[13px] leading-[19.5px] transition-colors hover:text-[#1b1b1b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b1b1b]/15 focus-visible:ring-offset-2"
                onClick={() => setPickerOpen(true)}
                type="button"
              >
                Select a plan
              </button>
            </div>
          </div>
        </div>
      </div>
      <UpgradeDialog getToken={getToken} onClose={() => setPickerOpen(false)} open={pickerOpen} />
    </div>
  );
}

function useComposerUsageTier(): null | string {
  const [tier, setTier] = useState<null | string>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadUsageTier() {
      const nextTier = await loadComposerUsageTier();
      if (!isCancelled) {
        setTier(nextTier);
      }
    }

    void loadUsageTier();

    return () => {
      isCancelled = true;
    };
  }, []);

  return tier;
}

async function loadComposerUsageTier(): Promise<null | string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const tier = await readComposerUsageTier();
    if (tier) {
      return tier;
    }
    await wait(250);
  }
  return null;
}

async function readComposerUsageTier(): Promise<null | string> {
  const browserToken = readComposerBrowserToken();
  if (!browserToken) {
    return null;
  }
  try {
    const response = await fetch(gatewayRequestUrl(env.NEXT_PUBLIC_GATEWAY_URL, "/v1/me/usage"), {
      headers: {
        Authorization: `Bearer ${browserToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      return null;
    }
    return SandboxUsageSummaryResponseSchema.parse(await response.json()).tier;
  } catch {
    return null;
  }
}

function readComposerBrowserToken(): null | string {
  try {
    return (
      (
        window as Window & { Clerk?: ClerkBrowserSession }
      ).Clerk?.session?.lastActiveToken?.getRawString?.() ?? null
    );
  } catch {
    return null;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildLaunchParams(input: {
  model: null | string;
  prompt: string;
  repo: null | string;
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
  if (input.repo) {
    params.set("repo", input.repo);
  }
  return params;
}

function RemovableChip({
  label,
  onClear,
  title,
}: {
  label: string;
  onClear: () => void;
  title?: string | undefined;
}) {
  return (
    <div
      className="flex h-8 items-center gap-2 rounded-full border border-[#f1f1f1] bg-white px-3 text-[#1b1b1b] text-[12px]"
      title={title}
    >
      <span className="max-w-40 truncate">{label}</span>
      <button
        aria-label={`Remove ${label}`}
        className="-mr-1.5 ml-0.5 flex h-6 w-6 items-center justify-center text-[#8a8a8a] transition-colors hover:text-[#1b1b1b]"
        onClick={onClear}
        type="button"
      >
        <X aria-hidden="true" className="h-3 w-3" />
      </button>
    </div>
  );
}

function repoLabel(url: string): string {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : "repository";
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

function usePromptHandoff(promptKey: string | undefined) {
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
