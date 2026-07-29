"use client";

import type { BrowserTakeoverController } from "@/components/preview/use-browser-takeover";

export function BrowserTakeoverSurface({
  browserTakeover,
}: {
  browserTakeover: BrowserTakeoverController;
}) {
  const session = browserTakeover.session;
  if (!session) return null;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20.5px] bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between border-border border-b px-3">
        <div className="flex items-center gap-2 font-medium text-[12px] text-fg-secondary">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-400" />
          You’re controlling the browser
        </div>
        <button
          className="h-7 rounded-full bg-foreground px-3 font-medium text-[12px] text-background transition-opacity hover:opacity-85 disabled:opacity-50"
          disabled={browserTakeover.isPending}
          onClick={() => void browserTakeover.resume()}
          type="button"
        >
          {browserTakeover.isPending ? "Resuming…" : "Resume Cheatcode"}
        </button>
      </div>
      <iframe
        allow="clipboard-read; clipboard-write; fullscreen"
        className="min-h-0 min-w-0 flex-1 border-0 bg-background"
        referrerPolicy="no-referrer"
        sandbox="allow-forms allow-pointer-lock allow-same-origin allow-scripts"
        src={session.url}
        title="Live browser takeover"
      />
    </div>
  );
}
