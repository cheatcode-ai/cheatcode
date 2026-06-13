"use client";

import { GitHubRepoUrlSchema } from "@cheatcode/types";
import { type FormEvent, useState } from "react";
import { Paperclip, Plus } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * The composer "+" menu: local file upload (delegates to the existing hidden file
 * input via `onUploadClick`) and one-shot public GitHub import. The repo URL is
 * validated client-side with the shared `GitHubRepoUrlSchema`; the gateway and DO
 * re-validate at their own trust boundaries.
 */
export function AddMenu({
  allowRepoImport = true,
  onRepoAttach,
  onUploadClick,
}: {
  allowRepoImport?: boolean | undefined;
  onRepoAttach: (url: string) => void;
  onUploadClick: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function close() {
    setIsOpen(false);
    setShowImport(false);
    setUrl("");
    setError(null);
  }

  function submitRepo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = GitHubRepoUrlSchema.safeParse(url);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid public GitHub URL.");
      return;
    }
    onRepoAttach(parsed.data);
    close();
  }

  return (
    <div className="relative">
      <button
        aria-expanded={isOpen}
        aria-label="Add to prompt"
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-none border border-white/5",
          "bg-gradient-to-b from-[#333] to-[#1a1a1a] text-zinc-400",
          "shadow-[0_1px_2px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]",
          "transition-all hover:from-[#3a3a3a] hover:to-[#222] hover:text-white",
        )}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </button>
      {isOpen ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-72 border border-white/10 bg-[#09090b] p-1 shadow-2xl">
          <button
            className="flex h-8 w-full items-center gap-2 px-2 font-mono text-[10px] text-zinc-400 uppercase tracking-widest transition-colors hover:bg-white/5 hover:text-white"
            onClick={() => {
              onUploadClick();
              close();
            }}
            type="button"
          >
            <Paperclip aria-hidden="true" className="h-3.5 w-3.5" />
            Upload file
          </button>
          {!allowRepoImport ? null : showImport ? (
            <form className="flex flex-col gap-1 p-1" onSubmit={submitRepo}>
              <input
                aria-label="Public GitHub repository URL"
                // biome-ignore lint/a11y/noAutofocus: focus the field the user just opened
                autoFocus
                className="w-full border border-white/10 bg-transparent px-2 py-1.5 font-mono text-[11px] text-white outline-none placeholder:text-zinc-600"
                onChange={(event) => {
                  setUrl(event.target.value);
                  setError(null);
                }}
                placeholder="https://github.com/owner/repo"
                value={url}
              />
              {error ? <span className="px-1 text-[10px] text-red-300">{error}</span> : null}
              <button
                className="flex h-8 items-center justify-center bg-white/10 font-mono text-[10px] text-white uppercase tracking-widest transition-colors hover:bg-white/15"
                type="submit"
              >
                Attach repository
              </button>
            </form>
          ) : (
            <button
              className="flex h-8 w-full items-center gap-2 px-2 font-mono text-[10px] text-zinc-400 uppercase tracking-widest transition-colors hover:bg-white/5 hover:text-white"
              onClick={() => setShowImport(true)}
              type="button"
            >
              <GitHubMark className="h-3.5 w-3.5" />
              Import from GitHub
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
