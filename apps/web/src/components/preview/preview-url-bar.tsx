"use client";

import { toast } from "sonner";
import { ExternalLink, RefreshCw } from "@/components/ui/icons";
import { buildPreviewIframeSrc, normalizePreviewPath, previewOrigin } from "@/lib/preview/url-bar";
import { useAppStore } from "@/lib/store/app-store";

const CONTROL_CLASS =
  "flex h-7 shrink-0 items-center justify-center border border-thread-border px-2 font-mono text-[10px] text-thread-text-secondary uppercase tracking-[0.16em] transition-colors hover:bg-thread-hover hover:text-thread-text-primary disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Functional preview URL bar (preview-surface §7.3 / §A5). The iframe is
 * cross-origin, so this shows and edits the *entry URL* we command — never the
 * live SPA location after in-app navigation. Back/Refresh operate on our own
 * assignment history + the existing reload token.
 */
export function PreviewUrlBar({ previewUrl }: { previewUrl: string }) {
  const previewPath = useAppStore((state) => state.previewPath);
  const previewPathHistory = useAppStore((state) => state.previewPathHistory);
  const bumpPreviewReloadToken = useAppStore((state) => state.bumpPreviewReloadToken);
  const goBackPreviewPath = useAppStore((state) => state.goBackPreviewPath);
  const navigatePreviewPath = useAppStore((state) => state.navigatePreviewPath);
  const origin = previewOrigin(previewUrl);

  const commitPath = (raw: string) => {
    const next = normalizePreviewPath(raw, previewUrl);
    if (next === null) {
      toast.error("Preview can only navigate within the sandbox origin");
      return;
    }
    navigatePreviewPath(next);
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-thread-border-subtle border-b px-3">
      <button
        className={CONTROL_CLASS}
        disabled={previewPathHistory.length === 0}
        onClick={goBackPreviewPath}
        type="button"
      >
        Back
      </button>
      <button
        aria-label="Refresh preview"
        className={CONTROL_CLASS}
        onClick={bumpPreviewReloadToken}
        type="button"
      >
        <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <span className="shrink-0 truncate font-mono text-[10px] text-thread-text-muted">
        {origin}
      </span>
      <input
        aria-label="Preview path"
        className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-thread-text-secondary outline-none placeholder:text-thread-text-muted"
        defaultValue={previewPath}
        key={previewPath}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commitPath(event.currentTarget.value);
          }
        }}
        placeholder="/"
        spellCheck={false}
      />
      <a
        aria-label="Open preview in a new tab"
        className={CONTROL_CLASS}
        href={buildPreviewIframeSrc(previewUrl, previewPath, 0)}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
