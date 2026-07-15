"use client";

import { GitHubRepoUrlSchema } from "@cheatcode/types";
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react";

interface RepoImportController {
  actions: {
    show: () => void;
    submit: () => void;
    updateUrl: (url: string) => void;
  };
  meta: {
    errorId: string;
    inputRef: RefObject<HTMLInputElement | null>;
  };
  state: {
    error: string | null;
    isEditing: boolean;
    url: string;
  };
}

export function RepoImportControl({
  allowed,
  onAttach,
}: {
  allowed: boolean;
  onAttach: (url: string) => void;
}) {
  const controller = useRepoImportController(onAttach);
  if (!allowed) return null;
  return controller.state.isEditing ? (
    <RepoImportForm controller={controller} />
  ) : (
    <RepoImportButton onClick={controller.actions.show} />
  );
}

function useRepoImportController(onAttach: (url: string) => void): RepoImportController {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const errorId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);
  const submit = () => {
    const parsed = GitHubRepoUrlSchema.safeParse(url);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid public GitHub URL.");
      return;
    }
    onAttach(parsed.data);
  };
  return {
    actions: {
      show: () => setIsEditing(true),
      submit,
      updateUrl: (nextUrl) => {
        setUrl(nextUrl);
        setError(null);
      },
    },
    meta: { errorId, inputRef },
    state: { error, isEditing, url },
  };
}

function RepoImportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-[13px] text-fg-secondary transition-colors hover:bg-secondary hover:text-foreground"
      onClick={onClick}
      type="button"
    >
      <GitHubMark className="h-3.5 w-3.5" />
      Import from GitHub
    </button>
  );
}

function RepoImportForm({ controller }: { controller: RepoImportController }) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    controller.actions.submit();
  };
  return (
    <div className="flex flex-col gap-1 p-1">
      <input
        aria-describedby={controller.state.error ? controller.meta.errorId : undefined}
        aria-invalid={controller.state.error ? true : undefined}
        aria-label="Public GitHub repository URL"
        className="w-full rounded-xl border border-border bg-bg-secondary px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-placeholder"
        onChange={(event) => controller.actions.updateUrl(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="https://github.com/owner/repo"
        ref={controller.meta.inputRef}
        value={controller.state.url}
      />
      {controller.state.error ? (
        <span className="px-1 text-[11px] text-red-600" id={controller.meta.errorId} role="alert">
          {controller.state.error}
        </span>
      ) : null}
      <button
        className="flex h-9 items-center justify-center rounded-xl bg-foreground font-medium text-[13px] text-background transition-colors hover:bg-foreground/90"
        onClick={controller.actions.submit}
        type="button"
      >
        Attach repository
      </button>
    </div>
  );
}

function GitHubMark({ className }: { className?: string | undefined }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
