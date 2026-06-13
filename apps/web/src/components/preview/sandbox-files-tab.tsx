"use client";

import type { SandboxFile, SandboxFileEntry } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  compareFileEntries,
  listSandboxFiles,
  readSandboxFile,
  sandboxFileQueryKey,
  updateSandboxFile,
} from "@/lib/api/sandbox";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

const DEFAULT_FILE_PATH = "/workspace/app/src/app/page.tsx";
const DEFAULT_FILE_ROOT = "/workspace/app";
const SECONDARY_PREVIEW_RELOAD_DELAY_MS = 2_500;
const BINARY_DATA_EXTENSIONS = [".db", ".sqlite", ".sqlite3"] as const;
const READ_ONLY_DATA_EXTENSIONS = [".csv", ".tsv", ".jsonl"] as const;
const DATA_DIRECTORY_SEGMENT = "/data/";

function isBinaryDataFile(path: string): boolean {
  return BINARY_DATA_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function isReadOnlyDataFile(path: string): boolean {
  return (
    READ_ONLY_DATA_EXTENSIONS.some((extension) => path.endsWith(extension)) ||
    path.includes(DATA_DIRECTORY_SEGMENT)
  );
}

export function SandboxFilesTab({
  previewUrl,
  sandboxStatus,
  threadId,
}: {
  previewUrl: string | null;
  sandboxStatus: string;
  threadId: string;
}) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [selectedPath, setSelectedPath] = useState(DEFAULT_FILE_PATH);
  const selectedIsBinary = isBinaryDataFile(selectedPath);
  const filesQuery = useSandboxFilesQuery(getToken, threadId, Boolean(previewUrl));
  const fileQuery = useSandboxFileQuery(
    getToken,
    threadId,
    selectedPath,
    Boolean(previewUrl) && !selectedIsBinary,
  );
  const saveMutation = useSaveSandboxFile(getToken, queryClient, threadId, selectedPath);
  const listedFiles = filesQuery.data?.files;
  const selectedEntry = listedFiles?.find((entry) => entry.path === selectedPath) ?? null;

  useEffect(() => {
    if (!listedFiles || listedFiles.some((entry) => entry.path === selectedPath)) {
      return;
    }
    const firstFile = listedFiles.find((entry) => entry.type === "file");
    if (firstFile) {
      setSelectedPath(firstFile.path);
    }
  }, [listedFiles, selectedPath]);

  if (!previewUrl) {
    return <FilesPlaceholder sandboxStatus={sandboxStatus} />;
  }
  if (filesQuery.isError) {
    return <FilesError message={filesQuery.error.message} onRetry={() => filesQuery.refetch()} />;
  }

  return (
    <div className="grid h-full min-h-[520px] grid-cols-[240px_minmax(0,1fr)] border border-thread-border bg-[var(--thread-code-bg)]">
      <FileList
        entries={filesQuery.data?.files ?? []}
        isLoading={filesQuery.isPending}
        onSelect={setSelectedPath}
        selectedPath={selectedPath}
      />
      {selectedIsBinary ? (
        <BinaryFileMetadata entry={selectedEntry} path={selectedPath} />
      ) : (
        <FileEditor
          file={fileQuery.data}
          isLoading={fileQuery.isPending}
          isSaving={saveMutation.isPending}
          loadError={fileQuery.isError ? fileQuery.error.message : null}
          onRetry={() => fileQuery.refetch()}
          onSave={(content) => saveMutation.mutate(content)}
        />
      )}
    </div>
  );
}

function FileList({
  entries,
  isLoading,
  onSelect,
  selectedPath,
}: {
  entries: SandboxFileEntry[];
  isLoading: boolean;
  onSelect: (path: string) => void;
  selectedPath: string;
}) {
  const sortedEntries = [...entries].sort(compareFileEntries);

  return (
    <div className="min-w-0 border-thread-border-subtle border-r">
      <div className="flex h-10 items-center border-thread-border-subtle border-b px-3 font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.22em]">
        Files
      </div>
      <div className="chat-scrollbar h-[calc(100%-2.5rem)] overflow-y-auto p-2">
        {isLoading ? (
          <div className="px-2 py-3 font-mono text-[10px] text-thread-text-tertiary uppercase tracking-[0.18em]">
            Loading
          </div>
        ) : null}
        {sortedEntries.map((entry) => (
          <button
            className={cn(
              "block w-full truncate px-2 py-1.5 text-left font-mono text-[11px] transition-colors",
              entry.type === "file"
                ? "text-thread-text-secondary hover:bg-thread-hover hover:text-thread-text-primary"
                : "cursor-default text-thread-text-tertiary",
              selectedPath === entry.path && "bg-thread-surface text-thread-text-primary",
            )}
            disabled={entry.type !== "file"}
            key={entry.path}
            onClick={() => onSelect(entry.path)}
            title={entry.path}
            type="button"
          >
            {entry.type === "directory" ? "./" : ""}
            {entry.relativePath}
          </button>
        ))}
      </div>
    </div>
  );
}

function FileEditor({
  file,
  isLoading,
  isSaving,
  loadError,
  onRetry,
  onSave,
}: {
  file: SandboxFile | undefined;
  isLoading: boolean;
  isSaving: boolean;
  loadError: string | null;
  onRetry: () => void;
  onSave: (content: string) => void;
}) {
  if (isLoading) {
    return <FilesPlaceholder sandboxStatus="loading" />;
  }
  if (loadError) {
    return <FilesError message={loadError} onRetry={onRetry} />;
  }
  if (!file) {
    return <FilesPlaceholder sandboxStatus="empty" />;
  }
  if (isReadOnlyDataFile(file.path)) {
    return <ReadOnlyFilePreview file={file} key={file.path} />;
  }
  return <EditableFileForm file={file} isSaving={isSaving} key={file.path} onSave={onSave} />;
}

function ReadOnlyFilePreview({ file }: { file: SandboxFile }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-thread-border-subtle border-b px-3">
        <div className="min-w-0 truncate font-mono text-[10px] text-thread-text-secondary">
          {file.path}
        </div>
        <div className="ml-3 shrink-0 font-mono text-[9px] text-thread-text-tertiary uppercase tracking-[0.18em]">
          Read-only
        </div>
      </div>
      <pre className="chat-scrollbar min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] text-thread-text-secondary leading-5">
        {file.content}
      </pre>
    </div>
  );
}

function BinaryFileMetadata({ entry, path }: { entry: SandboxFileEntry | null; path: string }) {
  return (
    <div className="space-y-4 bg-black/30 p-4">
      <div className="font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.22em]">
        Binary data file
      </div>
      <dl className="space-y-2 font-mono text-[11px] text-thread-text-secondary">
        <div>
          <dt className="text-thread-text-tertiary">Path</dt>
          <dd>{path}</dd>
        </div>
        <div>
          <dt className="text-thread-text-tertiary">Size</dt>
          <dd>{entry ? `${entry.size} bytes` : "unknown"}</dd>
        </div>
        <div>
          <dt className="text-thread-text-tertiary">Modified</dt>
          <dd>{entry ? entry.modifiedAt : "unknown"}</dd>
        </div>
      </dl>
    </div>
  );
}

function EditableFileForm({
  file,
  isSaving,
  onSave,
}: {
  file: SandboxFile;
  isSaving: boolean;
  onSave: (content: string) => void;
}) {
  const [draft, setDraft] = useState(file.content);
  const hasChanges = draft !== file.content;

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-thread-border-subtle border-b px-3">
        <div className="min-w-0 truncate font-mono text-[10px] text-thread-text-secondary">
          {file.path}
        </div>
        <button
          className={cn(
            "ml-3 shrink-0 bg-white px-3 py-1 font-bold font-mono text-[9px] text-zinc-950 uppercase tracking-[0.18em] transition-colors hover:bg-zinc-200",
            (!hasChanges || isSaving) && "cursor-not-allowed opacity-45",
          )}
          disabled={!hasChanges || isSaving}
          onClick={() => onSave(draft)}
          type="button"
        >
          {isSaving ? "Saving" : "Save"}
        </button>
      </div>
      <textarea
        className="chat-scrollbar min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[11px] text-thread-text-secondary leading-5 outline-none"
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
        value={draft}
      />
    </div>
  );
}

function FilesPlaceholder({ sandboxStatus }: { sandboxStatus: string }) {
  return (
    <div className="grid h-full min-h-[420px] place-items-center bg-black/30">
      <div className="text-center">
        <div className="mx-auto mb-4 h-2 w-2 rounded-full bg-thread-status-warning" />
        <div className="font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.28em]">
          Files {sandboxStatus}
        </div>
      </div>
    </div>
  );
}

function FilesError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-3 bg-black/30 p-4">
      <div className="font-mono text-[10px] text-thread-status-danger uppercase tracking-[0.22em]">
        File unavailable
      </div>
      <p className="text-sm text-thread-text-secondary">{message}</p>
      <button
        className="border border-thread-border px-3 py-2 font-mono text-[10px] text-thread-text-secondary uppercase tracking-[0.18em] hover:bg-thread-hover hover:text-thread-text-primary"
        onClick={onRetry}
        type="button"
      >
        Retry
      </button>
    </div>
  );
}

function useSandboxFilesQuery(
  getToken: () => Promise<null | string>,
  threadId: string,
  enabled: boolean,
) {
  return useQuery({
    enabled,
    queryFn: () => listSandboxFiles(getToken, threadId, DEFAULT_FILE_ROOT),
    queryKey: ["sandbox-files", threadId, DEFAULT_FILE_ROOT] as const,
    staleTime: 5_000,
  });
}

function useSandboxFileQuery(
  getToken: () => Promise<null | string>,
  threadId: string,
  path: string,
  enabled: boolean,
) {
  return useQuery({
    enabled,
    queryFn: () => readSandboxFile(getToken, threadId, path),
    queryKey: sandboxFileQueryKey(threadId, path),
    staleTime: 5_000,
  });
}

function useSaveSandboxFile(
  getToken: () => Promise<null | string>,
  queryClient: ReturnType<typeof useQueryClient>,
  threadId: string,
  path: string,
) {
  const bumpPreviewReloadToken = useAppStore((state) => state.bumpPreviewReloadToken);
  return useMutation({
    mutationFn: (content: string) => updateSandboxFile(getToken, threadId, path, content),
    onError: (error) => toast.error(error.message),
    onSuccess: (file) => {
      queryClient.setQueryData<SandboxFile>(sandboxFileQueryKey(threadId, path), file);
      bumpPreviewReloadToken();
      globalThis.setTimeout(() => {
        bumpPreviewReloadToken();
      }, SECONDARY_PREVIEW_RELOAD_DELAY_MS);
      toast.success("File saved");
    },
  });
}
