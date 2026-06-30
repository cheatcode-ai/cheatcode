"use client";

import type { SandboxFileEntry } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ChevronRight,
  Code,
  FileCode,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  type LucideIcon,
  Presentation,
} from "@/components/ui/icons";
import { compareFileEntries, listSandboxFiles } from "@/lib/api/sandbox";
import { cn } from "@/lib/ui/cn";

export const SANDBOX_ROOT = "/workspace";

/**
 * Recursive, lazily-loaded sandbox file tree (bud parity). Each folder fetches its
 * own children via the single-directory list endpoint only when expanded, so deep
 * trees stay cheap; react-query caches each level by path.
 */
export function FileTree({
  enabled,
  onSelect,
  selectedPath,
  threadId,
}: {
  enabled: boolean;
  onSelect: (path: string) => void;
  selectedPath: string;
  threadId: string;
}) {
  return (
    <div className="chat-scrollbar h-full overflow-y-auto py-1">
      <FileTreeLevel
        defaultOpen
        depth={0}
        enabled={enabled}
        onSelect={onSelect}
        path={SANDBOX_ROOT}
        selectedPath={selectedPath}
        threadId={threadId}
      />
    </div>
  );
}

function FileTreeLevel({
  defaultOpen = false,
  depth,
  enabled,
  onSelect,
  path,
  selectedPath,
  threadId,
}: {
  defaultOpen?: boolean;
  depth: number;
  enabled: boolean;
  onSelect: (path: string) => void;
  path: string;
  selectedPath: string;
  threadId: string;
}) {
  const { getToken } = useAuth();
  const query = useQuery({
    enabled,
    queryFn: () => listSandboxFiles(getToken, threadId, path),
    queryKey: ["sandbox-files", threadId, path] as const,
    staleTime: 5_000,
  });

  if (query.isError) {
    // The first sandbox access after sleep can be slow (the worker wakes it) but
    // resolves; a true failure gets a retry rather than a misleading "No files yet".
    return depth === 0 ? <TreeRetry depth={depth} onRetry={() => void query.refetch()} /> : null;
  }
  if (query.isPending) {
    return <TreeHint depth={depth} text={depth === 0 ? "Loading files…" : "Loading…"} />;
  }
  const entries = (query.data?.files ?? []).toSorted(compareFileEntries);
  if (entries.length === 0) {
    return depth === 0 ? <TreeHint depth={depth} text="No files yet" /> : null;
  }

  return (
    <ul>
      {entries.map((entry) => (
        <FileTreeNode
          defaultOpen={defaultOpen && depth === 0 && entries.length === 1}
          depth={depth}
          entry={entry}
          key={entry.path}
          onSelect={onSelect}
          selectedPath={selectedPath}
          threadId={threadId}
        />
      ))}
    </ul>
  );
}

function FileTreeNode({
  defaultOpen,
  depth,
  entry,
  onSelect,
  selectedPath,
  threadId,
}: {
  defaultOpen: boolean;
  depth: number;
  entry: SandboxFileEntry;
  onSelect: (path: string) => void;
  selectedPath: string;
  threadId: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isDirectory = entry.type === "directory";
  const isSelected = !isDirectory && selectedPath === entry.path;
  const Icon = isDirectory ? (open ? FolderOpen : Folder) : fileIcon(entry.relativePath);

  return (
    <li>
      <button
        className={cn(
          "flex h-[22px] w-full items-center gap-1.5 rounded-[4px] pr-2 text-left text-[13px] transition-colors",
          isSelected
            ? "bg-[#e8f0fe] text-[#1b1b1b]"
            : "text-[#3f3f3f] hover:bg-[#f1f1f1] hover:text-[#1b1b1b]",
        )}
        onClick={() => (isDirectory ? setOpen((value) => !value) : onSelect(entry.path))}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={entry.path}
        type="button"
      >
        {isDirectory ? (
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "h-3 w-3 shrink-0 text-[#8a8a8a] transition-transform",
              open && "rotate-90",
            )}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#8a8a8a]" />
        <span className="truncate">{entry.relativePath}</span>
      </button>
      {isDirectory && open ? (
        <FileTreeLevel
          depth={depth + 1}
          enabled
          onSelect={onSelect}
          path={entry.path}
          selectedPath={selectedPath}
          threadId={threadId}
        />
      ) : null}
    </li>
  );
}

function TreeHint({ depth, text }: { depth: number; text: string }) {
  return (
    <div
      className="py-1.5 text-[12px] text-thread-text-tertiary"
      style={{ paddingLeft: `${depth * 12 + 12}px` }}
    >
      {text}
    </div>
  );
}

function TreeRetry({ depth, onRetry }: { depth: number; onRetry: () => void }) {
  return (
    <div
      className="flex flex-col items-start gap-1.5 py-2 text-[12px] text-thread-text-tertiary"
      style={{ paddingLeft: `${depth * 12 + 12}px` }}
    >
      <span>Couldn’t load files.</span>
      <button
        className="rounded-full border border-thread-border px-2.5 py-1 text-[11px] text-thread-text-secondary transition-colors hover:bg-thread-hover hover:text-thread-text-primary"
        onClick={onRetry}
        type="button"
      >
        Retry
      </button>
    </div>
  );
}

const CODE_EXTENSIONS = new Set([
  "cjs",
  "css",
  "go",
  "java",
  "js",
  "jsx",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "swift",
  "ts",
  "tsx",
  "vue",
]);

function fileIcon(name: string): LucideIcon {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  if (CODE_EXTENSIONS.has(extension)) {
    return FileCode;
  }
  if (extension === "html" || extension === "json" || extension === "xml" || extension === "yaml") {
    return Code;
  }
  if (extension === "csv" || extension === "tsv" || extension === "xlsx") {
    return FileSpreadsheet;
  }
  if (["gif", "ico", "jpeg", "jpg", "png", "svg", "webp"].includes(extension)) {
    return ImageIcon;
  }
  if (extension === "pptx" || extension === "key") {
    return Presentation;
  }
  return FileText;
}
