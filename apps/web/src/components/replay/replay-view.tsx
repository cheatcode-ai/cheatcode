"use client";

import type { CheatcodeUIMessage, PublicReplay, PublicReplayMessage } from "@cheatcode/types";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { MessageList } from "@/components/chat/message-list";
import { Loader2, RefreshCw } from "@/components/ui/icons";
import { fetchPublicReplay, ReplayRequestError } from "@/lib/api/replays";

/**
 * Client wrapper for the public `/replay/[id]` page. Fetches the sanitized
 * transcript via react-query (so the XHR is inspectable in the network tab) and
 * renders the existing read-only `MessageList`. Data arrives after the server
 * render, so `notFound()` is unavailable — 400/404 render branded not-found
 * content in place (the page URL still serves 200), other errors offer a retry.
 */
export function ReplayView({ id }: { id: string }) {
  const replayQuery = useQuery({
    queryFn: () => fetchPublicReplay(id),
    queryKey: ["replay", id],
    retry: (failureCount, error) => !(error instanceof ReplayRequestError) && failureCount < 1,
    staleTime: 5 * 60_000,
  });

  if (replayQuery.isPending) {
    return <ReplayLoading />;
  }
  if (replayQuery.isError) {
    if (isUnavailable(replayQuery.error)) {
      return <ReplayNotFound />;
    }
    return (
      <ReplayError
        onRetry={() => {
          void replayQuery.refetch();
        }}
      />
    );
  }
  return <ReplayTranscript replay={replayQuery.data} />;
}

function ReplayTranscript({ replay }: { replay: PublicReplay }) {
  const messages = replay.messages.map(toUiMessage);
  return (
    <div className="flex h-screen flex-col bg-thread-panel text-white">
      <ReplayHeader replay={replay.replay} />
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageList messages={messages} />
      </div>
    </div>
  );
}

function ReplayHeader({ replay }: { replay: PublicReplay["replay"] }) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-zinc-800 border-b px-4 py-3 font-mono">
      <div className="flex flex-col gap-1">
        <span className="text-[9px] text-thread-text-muted uppercase tracking-[0.28em]">
          Replay
        </span>
        <h1 className="font-medium text-sm text-white">{replay.title}</h1>
        <p className="text-[11px] text-zinc-500">
          {replay.authorName}
          {replay.date ? ` · ${formatDate(replay.date)}` : ""}
        </p>
      </div>
      <Link
        className="shrink-0 text-[11px] text-zinc-400 uppercase tracking-wider hover:text-white"
        href="/"
      >
        Cheatcode
      </Link>
    </header>
  );
}

function ReplayLoading() {
  return (
    <ReplayMessage>
      <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
      <p className="text-xs">Loading replay…</p>
    </ReplayMessage>
  );
}

function ReplayNotFound() {
  return (
    <ReplayMessage>
      <h1 className="font-medium text-sm text-white">Replay not found</h1>
      <p className="max-w-sm text-xs text-zinc-500">
        This replay is unavailable or no longer exists.
      </p>
      <Link
        className="text-[11px] text-zinc-400 uppercase tracking-wider hover:text-white"
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
      <h1 className="font-medium text-sm text-white">Could not load replay</h1>
      <p className="max-w-sm text-xs text-zinc-500">Something went wrong fetching this replay.</p>
      <button
        className="flex items-center gap-2 border border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-300 uppercase tracking-wider hover:bg-zinc-900"
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
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-thread-panel px-6 text-center font-mono text-zinc-400">
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
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
