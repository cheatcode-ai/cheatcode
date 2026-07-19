"use client";

import type { ProjectSummary, Thread } from "@cheatcode/types";
import { Search } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { useInfiniteQuery } from "@tanstack/react-query";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import {
  type FolderChatResultStatus,
  filterFolderThreads,
  folderChatResultStatus,
} from "@/components/chat/chat-context-model";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { type CursorPage, listProjectThreadsPage } from "@/lib/api/project-thread";
import { cn } from "@/lib/ui/cn";

export function FolderChatsSearch({
  activeThreadId,
  onSelect,
  project,
}: {
  activeThreadId: string;
  onSelect: (thread: Thread) => void;
  project: ProjectSummary;
}) {
  const { getToken } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const threadQuery = useInfiniteQuery({
    getNextPageParam: (page: CursorPage<Thread>) =>
      page.has_more ? (page.next_cursor ?? undefined) : undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listProjectThreadsPage(getToken, project.id, pageParam, 25, signal),
    queryKey: ["folder-chats", project.id],
    retry: false,
    staleTime: 30_000,
  });
  const threads = filterFolderThreads(
    threadQuery.data?.pages.flatMap((page) => page.data) ?? [],
    query,
  );
  useFocusOnMount(inputRef);
  return (
    <div className="cc-fade-in absolute top-full left-1/2 z-40 w-[calc(100%-1rem)] max-w-[720px] -translate-x-1/2 rounded-[18px] bg-secondary p-2">
      <FolderChatSearchInput inputRef={inputRef} query={query} setQuery={setQuery} />
      <FolderChatResults
        activeThreadId={activeThreadId}
        hasMore={Boolean(threadQuery.hasNextPage)}
        isLoadingMore={threadQuery.isFetchingNextPage}
        onLoadMore={() => void threadQuery.fetchNextPage()}
        onRetry={() => void threadQuery.refetch()}
        onSelect={onSelect}
        status={folderChatResultStatus(threadQuery.isPending, threadQuery.isError)}
        threads={threads}
      />
    </div>
  );
}

function useFocusOnMount(inputRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => inputRef.current?.focus(), [inputRef]);
}

function FolderChatSearchInput({
  inputRef,
  query,
  setQuery,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: (query: string) => void;
}) {
  return (
    <label className="relative block pb-2">
      <span className="sr-only">Search...</span>
      <Search
        aria-hidden="true"
        className="absolute top-4 left-3 size-4 -translate-y-1/2 text-fg-secondary"
      />
      <input
        aria-label="Search..."
        className="h-8 w-full rounded-full border-0 bg-background pr-3 pl-9 font-medium text-foreground text-sm outline-none placeholder:text-placeholder"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search..."
        ref={inputRef}
        value={query}
      />
    </label>
  );
}

interface FolderChatResultsProps {
  activeThreadId: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onSelect: (thread: Thread) => void;
  status: FolderChatResultStatus;
  threads: readonly Thread[];
}

function FolderChatResults(props: FolderChatResultsProps) {
  let content: ReactNode;
  if (props.status === "loading") {
    content = (
      <CheatcodeLoader
        className="min-h-10 px-2.5 py-1"
        label="Loading chats"
        markClassName="size-5"
      />
    );
  } else if (props.status === "error") {
    content = <FolderChatError onRetry={props.onRetry} />;
  } else if (props.threads.length === 0 && !props.hasMore) {
    content = <p className="px-2.5 py-1 text-placeholder text-sm">No matching chats</p>;
  } else {
    content = <ReadyFolderChatResults {...props} />;
  }
  return <div className="flex max-h-52 flex-col gap-0.5 overflow-y-auto p-1">{content}</div>;
}

function ReadyFolderChatResults(props: FolderChatResultsProps) {
  return (
    <>
      {props.threads.map((thread) => (
        <FolderChatButton
          active={thread.id === props.activeThreadId}
          key={thread.id}
          onClick={() => props.onSelect(thread)}
          title={thread.title?.trim() || "New chat"}
        />
      ))}
      {props.hasMore ? (
        <button
          className="h-8 rounded-full px-2.5 text-left font-medium text-fg-secondary text-sm transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
          disabled={props.isLoadingMore}
          onClick={props.onLoadMore}
          type="button"
        >
          {props.isLoadingMore ? "Loading..." : "Load older chats"}
        </button>
      ) : null}
    </>
  );
}

function FolderChatError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 px-2.5 text-sm">
      <span className="text-placeholder">Couldn't load chats</span>
      <button
        className="rounded-full bg-background px-2.5 py-1 font-medium text-fg-secondary text-xs transition-colors hover:text-foreground"
        onClick={onRetry}
        type="button"
      >
        Try again
      </button>
    </div>
  );
}

function FolderChatButton({
  active = false,
  disabled = false,
  onClick,
  title,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 w-full items-center rounded-full px-2.5 text-left text-sm transition-colors disabled:cursor-default disabled:opacity-50",
        active
          ? "bg-background font-medium text-foreground"
          : "text-foreground hover:bg-background",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="min-w-0 truncate">{title}</span>
    </button>
  );
}
