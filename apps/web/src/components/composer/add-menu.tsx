"use client";

import { GitHubRepoUrlSchema } from "@cheatcode/types";
import { type KeyboardEvent, useState } from "react";
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

  function submitRepo() {
    const parsed = GitHubRepoUrlSchema.safeParse(url);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid public GitHub URL.");
      return;
    }
    onRepoAttach(parsed.data);
    close();
  }

  function handleRepoKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    submitRepo();
  }

  return (
    <div className="relative">
      <button
        aria-expanded={isOpen}
        aria-label="Add to prompt"
        className={cn(
          "paper-focus-ring flex h-8 w-8 items-center justify-center rounded-full",
          "bg-white text-[#4f4f4f] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]",
        )}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </button>
      {isOpen ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 flex w-72 flex-col gap-1 rounded-2xl border border-[#f1f1f1] bg-white p-1 shadow-[0_18px_60px_rgba(0,0,0,0.12)]">
          <button
            className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-[#4f4f4f] text-[13px] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
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
            <div className="flex flex-col gap-1 p-1">
              <input
                aria-label="Public GitHub repository URL"
                // biome-ignore lint/a11y/noAutofocus: focus the field the user just opened
                autoFocus
                className="w-full rounded-xl border border-[#f1f1f1] bg-[#f8f8f8] px-3 py-2 text-[#1b1b1b] text-[13px] outline-none placeholder:text-[#a0a0a0]"
                onChange={(event) => {
                  setUrl(event.target.value);
                  setError(null);
                }}
                onKeyDown={handleRepoKeyDown}
                placeholder="https://github.com/owner/repo"
                value={url}
              />
              {error ? <span className="px-1 text-[11px] text-red-600">{error}</span> : null}
              <button
                className="flex h-9 items-center justify-center rounded-xl bg-[#1b1b1b] font-medium text-[13px] text-white transition-colors hover:bg-black"
                onClick={submitRepo}
                type="button"
              >
                Attach repository
              </button>
            </div>
          ) : (
            <button
              className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-[#4f4f4f] text-[13px] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
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
