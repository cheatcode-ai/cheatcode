"use client";

import type { CheatcodeUIMessage, PublicReplay, PublicReplayMessage } from "@cheatcode/types";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { MessageList } from "@/components/chat/message-list";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import {
  Check,
  Code,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  Monitor,
  RefreshCw,
} from "@/components/ui/icons";
import { fetchPublicReplay, ReplayRequestError } from "@/lib/api/replays";
import { cn } from "@/lib/ui/cn";
import type { SeededReplay, SeededReplayArtifact, SeededReplayFile } from "./seeded-replays";
import { seededReplayById } from "./seeded-replays";

const REPLAY_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const PREPARING_DELAY_MS = 720;
const STEP_DELAY_MS = 760;
const FINISH_DELAY_MS = 520;

type ReplayPhase = "complete" | "playing" | "preparing";
type ComputerTab = "browser" | "files";

/**
 * Client wrapper for `/replay/[id]`. Seeded homepage replays run locally so the
 * cards always demonstrate a complete flow; public backend replays still fetch
 * sanitized transcripts as a fallback.
 */
export function ReplayView({ id }: { id: string }) {
  const seededReplay = seededReplayById(id);
  if (seededReplay) {
    return <SeededReplayExperience replay={seededReplay} />;
  }
  return <RemoteReplayView id={id} />;
}

function SeededReplayExperience({ replay }: { replay: SeededReplay }) {
  const [phase, setPhase] = useState<ReplayPhase>("preparing");
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [computerOpen, setComputerOpen] = useState(false);
  const [computerTab, setComputerTab] = useState<ComputerTab>("browser");
  const tryHref = useMemo(() => `/?prompt=${encodeURIComponent(replay.prompt)}`, [replay.prompt]);

  useEffect(() => {
    if (phase === "preparing") {
      const timeout = window.setTimeout(() => {
        setVisibleSteps(1);
        setPhase("playing");
      }, PREPARING_DELAY_MS);
      return () => window.clearTimeout(timeout);
    }

    if (phase !== "playing") {
      return;
    }

    if (visibleSteps >= replay.steps.length) {
      const timeout = window.setTimeout(() => {
        setComputerOpen(true);
        setComputerTab("browser");
        setPhase("complete");
      }, FINISH_DELAY_MS);
      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(() => {
      setVisibleSteps((current) => Math.min(current + 1, replay.steps.length));
    }, STEP_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [phase, replay.steps.length, visibleSteps]);

  function watchAgain() {
    setComputerOpen(false);
    setComputerTab("browser");
    setVisibleSteps(1);
    setPhase("playing");
  }

  function skipToResults() {
    setVisibleSteps(replay.steps.length);
    setComputerOpen(true);
    setComputerTab("browser");
    setPhase("complete");
  }

  return (
    <div className="relative min-h-screen bg-white text-[#1b1b1b] transition-[padding] duration-200 md:pl-[var(--cheatcode-sidebar-offset,16rem)]">
      <Suspense fallback={null}>
        <AppSidebar variant="full" />
      </Suspense>
      <button
        className={cn(
          "paper-focus-ring fixed top-5 right-5 z-30 inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium text-[14px] shadow-[0_0_1px_rgba(0,0,0,0.08)] transition-all duration-200",
          computerOpen
            ? "bg-[#1b1b1b] text-white hover:bg-black"
            : "bg-[#f7f7f7] text-[#1b1b1b] hover:bg-[#f1f1f1]",
        )}
        onClick={() => setComputerOpen((open) => !open)}
        type="button"
      >
        <Monitor aria-hidden="true" className="h-3.5 w-3.5" />
        Computer
      </button>
      <main className="min-h-screen px-5 pt-5 pb-6">
        <div
          className={cn(
            "mx-auto grid min-h-[calc(100vh-2.75rem)] w-full gap-5 transition-[max-width] duration-200",
            computerOpen
              ? "max-w-[1180px] lg:grid-cols-[minmax(320px,430px)_minmax(360px,1fr)]"
              : "max-w-[620px]",
          )}
        >
          <section className="flex min-h-0 flex-col">
            <Link
              className="paper-focus-ring mb-6 inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 font-medium text-[#707070] text-[14px] transition-colors hover:text-[#1b1b1b]"
              href="/"
            >
              <span aria-hidden="true">‹</span>
              Back
            </Link>
            <ReplayTimeline phase={phase} replay={replay} visibleSteps={visibleSteps} />
            <ReplayBottomBar
              onSkip={skipToResults}
              onWatchAgain={watchAgain}
              phase={phase}
              tryHref={tryHref}
            />
          </section>
          {computerOpen ? (
            <ReplayComputer
              computerTab={computerTab}
              onComputerTabChange={setComputerTab}
              replay={replay}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function ReplayTimeline({
  phase,
  replay,
  visibleSteps,
}: {
  phase: ReplayPhase;
  replay: SeededReplay;
  visibleSteps: number;
}) {
  if (phase === "preparing") {
    return <ReplayPreparingSkeleton replay={replay} />;
  }

  return (
    <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto pr-1 pb-6">
      <ReplayPromptCard replay={replay} />
      <div className="mt-5 space-y-3">
        {replay.steps.slice(0, visibleSteps).map((step, index) => (
          <div
            className="rounded-[18px] border border-[#f1f1f1] bg-white p-4 shadow-[0_0_1px_rgba(0,0,0,0.08)] transition-all duration-200"
            key={step.title}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  index + 1 === visibleSteps && phase === "playing"
                    ? "bg-[#1b1b1b] text-white"
                    : "bg-[#f7f7f7] text-[#707070]",
                )}
              >
                {index + 1 === visibleSteps && phase === "playing" ? (
                  <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                ) : (
                  <Check aria-hidden="true" className="h-3 w-3" />
                )}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-[15px] leading-6">{step.title}</p>
                {step.detail ? (
                  <p className="mt-0.5 text-[#707070] text-[13px] leading-5">{step.detail}</p>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
      {phase === "complete" ? <ReplayResult replay={replay} /> : null}
    </div>
  );
}

function ReplayPreparingSkeleton({ replay }: { replay: SeededReplay }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center">
      <ReplayPromptCard replay={replay} />
      <div className="mt-5 space-y-3" role="status">
        <span className="sr-only">Preparing replay</span>
        {[0, 1, 2].map((row) => (
          <div
            className="rounded-[18px] border border-[#f1f1f1] bg-white p-4 shadow-[0_0_1px_rgba(0,0,0,0.08)]"
            key={row}
          >
            <div className="h-3 w-24 rounded-full bg-[#f1f1f1]" />
            <div className="mt-3 h-3 w-full rounded-full bg-[#f7f7f7]" />
            <div className="mt-2 h-3 w-3/4 rounded-full bg-[#f7f7f7]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ReplayPromptCard({ replay }: { replay: SeededReplay }) {
  return (
    <div className="rounded-[22px] border border-[#f1f1f1] bg-[#fafafa] p-1">
      <div className="rounded-[18px] bg-white p-4 shadow-[0_0_1px_rgba(0,0,0,0.08)]">
        <div className="flex items-center gap-2 text-[#707070] text-[13px]">
          <CheatcodeMark aria-hidden="true" className="h-4 w-4 text-[#f8af2c]" />
          Replay prompt
        </div>
        <p className="mt-3 font-medium text-[18px] leading-7">{replay.prompt}</p>
        {replay.attachmentName ? (
          <div className="mt-3 inline-flex h-8 items-center gap-2 rounded-full bg-[#f7f7f7] px-3 text-[#4f4f4f] text-[13px]">
            <FileSpreadsheet aria-hidden="true" className="h-3.5 w-3.5" />
            {replay.attachmentName}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReplayResult({ replay }: { replay: SeededReplay }) {
  return (
    <div className="mt-5 rounded-[22px] border border-[#f1f1f1] bg-white p-5 shadow-[0_0_1px_rgba(0,0,0,0.08)]">
      <p className="font-semibold text-[18px] leading-7">{replay.resultTitle}</p>
      <p className="mt-2 text-[#4f4f4f] text-[14px] leading-6">{replay.resultIntro}</p>
      <ul className="mt-4 space-y-2">
        {replay.resultBody.map((line) => (
          <li className="flex gap-2 text-[14px] leading-6" key={line}>
            <Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-[#5b9a73]" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        {replay.artifacts.map((artifact) => (
          <ArtifactChip artifact={artifact} key={artifact.name} />
        ))}
      </div>
    </div>
  );
}

function ArtifactChip({ artifact }: { artifact: SeededReplayArtifact }) {
  const Icon =
    artifact.kind === "code" ? Code : artifact.kind === "csv" ? FileSpreadsheet : Download;
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-full bg-[#f7f7f7] px-3 text-[#4f4f4f] text-[13px]">
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {artifact.name}
    </span>
  );
}

function ReplayComputer({
  computerTab,
  onComputerTabChange,
  replay,
}: {
  computerTab: ComputerTab;
  onComputerTabChange: (tab: ComputerTab) => void;
  replay: SeededReplay;
}) {
  return (
    <aside className="hidden min-h-0 min-w-[360px] rounded-[24px] border border-[#f1f1f1] bg-[#fafafa] p-1 shadow-[0_0_1px_rgba(0,0,0,0.08)] lg:flex lg:flex-col">
      <div className="flex items-center justify-between px-3 py-2 pr-36">
        <div className="flex items-center gap-2">
          <Monitor aria-hidden="true" className="h-4 w-4 text-[#707070]" />
          <span className="font-semibold text-[14px]">Computer</span>
        </div>
        <div className="flex rounded-full bg-white p-0.5 shadow-[0_0_1px_rgba(0,0,0,0.08)]">
          {(["files", "browser"] as const).map((tab) => (
            <button
              className={cn(
                "paper-focus-ring h-7 rounded-full px-3 font-medium text-[13px] transition-colors duration-150",
                computerTab === tab
                  ? "bg-[#1b1b1b] text-white"
                  : "text-[#707070] hover:text-[#1b1b1b]",
              )}
              key={tab}
              onClick={() => onComputerTabChange(tab)}
              type="button"
            >
              {tab === "files" ? "Files" : "Browser"}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 rounded-[20px] border border-[#f1f1f1] bg-white">
        {computerTab === "files" ? (
          <ReplayFiles replay={replay} />
        ) : (
          <ReplayBrowser replay={replay} />
        )}
      </div>
    </aside>
  );
}

function ReplayFiles({ replay }: { replay: SeededReplay }) {
  return (
    <div className="grid h-full min-h-[540px] grid-cols-[240px_minmax(0,1fr)]">
      <div className="chat-scrollbar border-[#f1f1f1] border-r p-2">
        {replay.files.map((file) => (
          <ReplayFileNode file={file} key={file.name} />
        ))}
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-[#f1f1f1] border-b px-3 text-[#707070] text-[13px]">
          <Code aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="truncate">{replay.computerTabTitle}</span>
        </div>
        <pre className="chat-scrollbar min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-[#4f4f4f] text-[12px] leading-5">
          {artifactPreview(replay)}
        </pre>
      </div>
    </div>
  );
}

function ReplayFileNode({ depth = 0, file }: { depth?: number; file: SeededReplayFile }) {
  const Icon =
    file.type === "folder" ? Monitor : file.name.endsWith(".csv") ? FileSpreadsheet : Code;
  return (
    <div>
      <div
        className={cn(
          "flex h-7 items-center gap-2 rounded-full pr-2 text-[13px]",
          file.active ? "bg-[#f7f7f7] font-medium text-[#1b1b1b]" : "text-[#707070]",
        )}
        style={{ paddingLeft: 10 + depth * 14 }}
      >
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{file.name}</span>
      </div>
      {file.children?.map((child) => (
        <ReplayFileNode depth={depth + 1} file={child} key={`${file.name}/${child.name}`} />
      ))}
    </div>
  );
}

function ReplayBrowser({ replay }: { replay: SeededReplay }) {
  return (
    <div className="flex h-full min-h-[540px] flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-[#f1f1f1] border-b px-3">
        <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <div className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
        <div className="h-3 w-3 rounded-full bg-[#28c840]" />
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-2 rounded-full bg-[#f7f7f7] px-3 py-1 text-[#707070] text-[12px]">
          <ExternalLink aria-hidden="true" className="h-3 w-3" />
          <span className="truncate">preview.cheatcode.local/{replay.id}</span>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full min-w-[280px] max-w-sm rounded-[24px] border border-[#f1f1f1] bg-white p-5 text-center shadow-[0_12px_40px_rgba(0,0,0,0.06)]">
          <CheatcodeMark aria-hidden="true" className="mx-auto h-10 w-10 text-[#f8af2c]" />
          <p className="mt-4 font-semibold text-[20px] leading-7">{replay.artifactTitle}</p>
          <p className="mx-auto mt-2 max-w-xs text-[#707070] text-[14px] leading-6">
            {replay.previewText}
          </p>
          <div className="mt-5 grid gap-2">
            {replay.artifacts.slice(0, 3).map((artifact) => (
              <ArtifactChip artifact={artifact} key={artifact.name} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReplayBottomBar({
  onSkip,
  onWatchAgain,
  phase,
  tryHref,
}: {
  onSkip: () => void;
  onWatchAgain: () => void;
  phase: ReplayPhase;
  tryHref: string;
}) {
  const isComplete = phase === "complete";
  const status =
    phase === "preparing"
      ? "Cheatcode is preparing the replay..."
      : isComplete
        ? "Cheatcode replay"
        : "Cheatcode is replaying the task...";

  return (
    <div className="bud-composer-shell sticky bottom-3 mt-auto rounded-[24px] p-px">
      <div className="flex min-h-14 items-center justify-between gap-3 rounded-[21px] bg-white/95 px-4">
        <div className="flex min-w-0 items-center gap-2 text-[#707070] text-[14px]">
          <CheatcodeMark aria-hidden="true" className="h-4 w-4 text-[#f8af2c]" />
          <span className="truncate">{status}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isComplete ? (
            <button
              className="paper-focus-ring inline-flex h-8 items-center gap-2 rounded-full border border-[#f1f1f1] bg-white px-3 font-medium text-[13px] transition-all duration-200 hover:bg-[#f7f7f7]"
              onClick={onWatchAgain}
              type="button"
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              Watch again
            </button>
          ) : (
            <button
              className="paper-focus-ring inline-flex h-8 items-center rounded-full border border-[#f1f1f1] bg-white px-3 font-medium text-[13px] transition-all duration-200 hover:bg-[#f7f7f7]"
              onClick={onSkip}
              type="button"
            >
              Skip to results
            </button>
          )}
          <Link
            className="paper-focus-ring inline-flex h-8 items-center rounded-full bg-[#1b1b1b] px-3 font-medium text-[13px] text-white transition-all duration-200 hover:bg-black"
            href={tryHref}
          >
            Try it yourself
          </Link>
        </div>
      </div>
    </div>
  );
}

function artifactPreview(replay: SeededReplay): string {
  const list = replay.resultBody.map((line) => `- ${line}`).join("\n");
  return [
    `# ${replay.resultTitle}`,
    "",
    replay.resultIntro,
    "",
    "## Delivered",
    list,
    "",
    "## Artifacts",
    ...replay.artifacts.map((artifact) => `- ${artifact.name}`),
  ].join("\n");
}

function RemoteReplayView({ id }: { id: string }) {
  const {
    data: replay,
    error,
    isError,
    isPending,
    refetch,
  } = useQuery({
    queryFn: () => fetchPublicReplay(id),
    queryKey: ["replay", id],
    retry: (failureCount, error) => !(error instanceof ReplayRequestError) && failureCount < 1,
    staleTime: 5 * 60_000,
  });

  if (isPending) {
    return <ReplayLoading />;
  }
  if (isError) {
    if (isUnavailable(error)) {
      return <ReplayNotFound />;
    }
    return (
      <ReplayError
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }
  return <ReplayTranscript replay={replay} />;
}

function ReplayTranscript({ replay }: { replay: PublicReplay }) {
  const messages = replay.messages.map(toUiMessage);
  const tryHref = useMemo(() => forkHref(replay.messages), [replay.messages]);
  return (
    <div className="flex h-screen flex-col bg-white text-[#1b1b1b]">
      <ReplayHeader replay={replay.replay} tryHref={tryHref} />
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageList messages={messages} />
      </div>
    </div>
  );
}

function ReplayHeader({
  replay,
  tryHref,
}: {
  replay: PublicReplay["replay"];
  tryHref: null | string;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-[#f1f1f1] border-b bg-white px-4 py-3 font-mono">
      <div className="flex flex-col gap-1">
        <span className="text-[#a0a0a0] text-[9px] uppercase tracking-[0.28em]">Replay</span>
        <h1 className="font-medium text-[#1b1b1b] text-sm">{replay.title}</h1>
        <p className="text-[#8a8a8a] text-[11px]">
          {replay.authorName}
          {replay.date ? ` - ${formatDate(replay.date)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {tryHref ? (
          <Link
            className="paper-focus-ring inline-flex h-8 items-center rounded-full bg-[#1b1b1b] px-3 font-medium font-sans text-[13px] text-white transition-all duration-200 hover:bg-black"
            href={tryHref}
          >
            Try it yourself
          </Link>
        ) : null}
        <Link
          className="text-[#707070] text-[11px] uppercase tracking-wider hover:text-[#1b1b1b]"
          href="/"
        >
          Cheatcode
        </Link>
      </div>
    </header>
  );
}

/**
 * Forks the replay by reusing the source run's initial prompt. Pure client-side:
 * routes to the home composer, which bootstraps a BRAND-NEW project owned by the
 * current visitor — the shared/source thread is never touched (ownership-safe).
 */
function forkHref(messages: PublicReplay["messages"]): null | string {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) {
    return null;
  }
  const text = firstUser.parts
    .map((part) => (part.type === "text" && typeof part["text"] === "string" ? part["text"] : ""))
    .join("")
    .trim();
  return text.length > 0 ? `/?prompt=${encodeURIComponent(text)}` : null;
}

function ReplayLoading() {
  return (
    <ReplayMessage>
      <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
      <p className="text-xs">Loading replay...</p>
    </ReplayMessage>
  );
}

function ReplayNotFound() {
  return (
    <ReplayMessage>
      <h1 className="font-medium text-[#1b1b1b] text-sm">Replay not found</h1>
      <p className="max-w-sm text-[#707070] text-xs">
        This replay is unavailable or no longer exists.
      </p>
      <Link
        className="text-[#707070] text-[11px] uppercase tracking-wider hover:text-[#1b1b1b]"
        href="/"
      >
        Back to Cheatcode
      </Link>
    </ReplayMessage>
  );
}

function ReplayError({ onRetry }: { onRetry: () => void }) {
  return (
    <ReplayMessage>
      <h1 className="font-medium text-[#1b1b1b] text-sm">Could not load replay</h1>
      <p className="max-w-sm text-[#707070] text-xs">Something went wrong fetching this replay.</p>
      <button
        className="flex items-center gap-2 rounded-full border border-[#f1f1f1] px-3 py-1.5 text-[#707070] text-[11px] uppercase tracking-wider hover:bg-[#fafafa] hover:text-[#1b1b1b]"
        onClick={onRetry}
        type="button"
      >
        <RefreshCw aria-hidden="true" className="h-3 w-3" />
        Retry
      </button>
    </ReplayMessage>
  );
}

function ReplayMessage({ children }: { children: ReactNode }) {
  return (
    <div className="paper-dot-field flex h-screen flex-col items-center justify-center gap-3 bg-white px-6 text-center font-mono text-[#707070]">
      {children}
    </div>
  );
}

function toUiMessage(message: PublicReplayMessage): CheatcodeUIMessage {
  return {
    id: message.id,
    parts: message.parts as CheatcodeUIMessage["parts"],
    role: message.role,
  };
}

function isUnavailable(error: unknown): boolean {
  return error instanceof ReplayRequestError && (error.status === 400 || error.status === 404);
}

function formatDate(value: string): string {
  return REPLAY_DATE_FORMATTER.format(new Date(value));
}
