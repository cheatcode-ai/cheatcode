"use client";

import type { SandboxFile, SandboxFileEntry } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Eye,
  FilePlus,
  FolderPlus,
  type LucideIcon,
  MoreHorizontal,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
} from "@/components/ui/icons";
import {
  compareFileEntries,
  listSandboxFiles,
  readSandboxFile,
  sandboxFileQueryKey,
  updateSandboxFile,
} from "@/lib/api/sandbox";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";
import { FileContentView } from "./file-content-view";
import { FileTree, SANDBOX_ROOT } from "./file-tree";

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
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [selectedPath, setSelectedPath] = useState("");
  const sandboxReady = sandboxStatus === "ready" || previewUrl !== null;
  const selectedIsBinary = selectedPath !== "" && isBinaryDataFile(selectedPath);
  useDefaultSandboxFileSelection({
    enabled: sandboxReady,
    getToken,
    onSelect: setSelectedPath,
    selectedPath,
    threadId,
  });
  const fileQuery = useSandboxFileQuery(
    getToken,
    threadId,
    selectedPath,
    sandboxReady && selectedPath !== "" && !selectedIsBinary,
  );
  const saveMutation = useSaveSandboxFile(getToken, queryClient, threadId, selectedPath);

  if (!sandboxReady) {
    return <FilesPlaceholder sandboxStatus={sandboxStatus} />;
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-[20.5px] bg-white p-0.5">
      {!explorerOpen ? (
        <button
          aria-label="Toggle file explorer"
          className="absolute top-2 left-2 z-20 flex h-[26px] w-[26px] items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-[#f1f1f1] hover:text-[#1b1b1b]"
          onClick={() => setExplorerOpen(true)}
          type="button"
        >
          <PanelLeftOpen aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <div
        className={cn(
          "grid h-full min-h-0 overflow-hidden rounded-[20.5px] bg-white",
          explorerOpen ? "grid-cols-[300px_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]",
        )}
      >
        {explorerOpen ? (
          <div className="flex min-w-0 flex-col border-[#e8e8e8] border-r bg-[#f8f8f8]">
            <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-[#e8e8e8] border-b px-3">
              <div className="min-w-0 truncate font-semibold text-[#1b1b1b] text-[12px] uppercase">
                Workspace
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <ExplorerIconButton disabled icon={FilePlus} label="New file" />
                <ExplorerIconButton disabled icon={FolderPlus} label="New folder" />
                <ExplorerIconButton
                  icon={RefreshCw}
                  label="Refresh files"
                  onClick={() =>
                    void queryClient.invalidateQueries({ queryKey: ["sandbox-files", threadId] })
                  }
                />
                <ExplorerIconButton
                  icon={PanelLeftOpen}
                  label="Toggle file explorer"
                  onClick={() => setExplorerOpen(false)}
                />
                <ExplorerIconButton disabled icon={MoreHorizontal} label="More actions" />
              </div>
            </div>
            <div className="min-h-0 flex-1 px-1.5 py-1">
              <FileTree
                enabled={sandboxReady}
                onSelect={setSelectedPath}
                selectedPath={selectedPath}
                threadId={threadId}
              />
            </div>
          </div>
        ) : null}
        <div className="min-w-0 bg-white">
          {selectedPath === "" ? (
            <FilesPlaceholder sandboxStatus="select a file" />
          ) : selectedIsBinary ? (
            <BinaryFileMetadata path={selectedPath} />
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
      </div>
    </div>
  );
}

function ExplorerIconButton({
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-[#5f5f5f] transition-colors hover:bg-[#ececec] hover:text-[#1b1b1b] disabled:cursor-not-allowed disabled:opacity-35"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
    </button>
  );
}

function firstEditorFile(files: SandboxFileEntry[]): SandboxFileEntry | null {
  const sortedFiles = files.filter((file) => file.type === "file").toSorted(compareFilePreference);
  return sortedFiles[0] ?? null;
}

function useDefaultSandboxFileSelection({
  enabled,
  getToken,
  onSelect,
  selectedPath,
  threadId,
}: {
  enabled: boolean;
  getToken: () => Promise<null | string>;
  onSelect: (path: string) => void;
  selectedPath: string;
  threadId: string;
}) {
  const rootFilesQuery = useQuery({
    enabled: enabled && selectedPath === "",
    queryFn: () => listSandboxFiles(getToken, threadId, SANDBOX_ROOT),
    queryKey: ["sandbox-files", threadId, SANDBOX_ROOT] as const,
    staleTime: 5_000,
  });
  const firstDirectory = firstProjectDirectory(rootFilesQuery.data?.files ?? []);
  const firstDirectoryPath = firstDirectory?.path ?? "";
  const firstDirectoryFilesQuery = useQuery({
    enabled: enabled && selectedPath === "" && firstDirectoryPath !== "",
    queryFn: () => listSandboxFiles(getToken, threadId, firstDirectoryPath),
    queryKey: ["sandbox-files", threadId, firstDirectoryPath] as const,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (selectedPath !== "") {
      return;
    }
    const firstFile =
      firstEditorFile(rootFilesQuery.data?.files ?? []) ??
      firstEditorFile(firstDirectoryFilesQuery.data?.files ?? []);
    if (firstFile) {
      onSelect(firstFile.path);
    }
  }, [firstDirectoryFilesQuery.data?.files, onSelect, rootFilesQuery.data?.files, selectedPath]);
}

function firstProjectDirectory(files: SandboxFileEntry[]): SandboxFileEntry | null {
  const sortedDirectories = files
    .filter((file) => file.type === "directory" && isLikelyProjectDirectory(file.relativePath))
    .toSorted(compareDirectoryPreference);
  return sortedDirectories[0] ?? null;
}

function compareDirectoryPreference(left: SandboxFileEntry, right: SandboxFileEntry): number {
  const leftScore = directoryPreferenceScore(left.relativePath);
  const rightScore = directoryPreferenceScore(right.relativePath);
  if (leftScore !== rightScore) {
    return leftScore - rightScore;
  }
  return compareFileEntries(left, right);
}

function isLikelyProjectDirectory(path: string): boolean {
  const name = path.toLowerCase();
  return name !== "node_modules" && name !== ".git" && name !== "data";
}

function directoryPreferenceScore(path: string): number {
  const name = path.toLowerCase();
  if (name === "app" || name.endsWith("-app")) {
    return 0;
  }
  if (name.includes("dashboard") || name.includes("site") || name.includes("web")) {
    return 1;
  }
  return 2;
}

function compareFilePreference(left: SandboxFileEntry, right: SandboxFileEntry): number {
  const leftScore = filePreferenceScore(left.relativePath);
  const rightScore = filePreferenceScore(right.relativePath);
  if (leftScore !== rightScore) {
    return leftScore - rightScore;
  }
  return compareFileEntries(left, right);
}

function filePreferenceScore(path: string): number {
  if (path === "index.html") {
    return 0;
  }
  if (path === "package.json") {
    return 1;
  }
  if (path.toLowerCase() === "readme.md") {
    return 2;
  }
  return 3;
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
  return (
    <FileViewer
      file={file}
      isSaving={isSaving}
      key={file.path}
      onSave={onSave}
      readOnly={isReadOnlyDataFile(file.path)}
    />
  );
}

type FileViewMode = "edit" | "read";

/**
 * Mini-IDE file pane (bud parity): defaults to a rich, type-aware read view
 * (CSV tables, markdown, highlighted code) and flips to a raw editable textarea
 * with Save. Data files (`/data/`, csv/tsv/jsonl) stay read-only.
 */
function FileViewer({
  file,
  isSaving,
  onSave,
  readOnly,
}: {
  file: SandboxFile;
  isSaving: boolean;
  onSave: (content: string) => void;
  readOnly: boolean;
}) {
  const [mode, setMode] = useState<FileViewMode>("read");
  const [draft, setDraft] = useState(file.content);
  const effectiveMode: FileViewMode = readOnly ? "read" : mode;
  const hasChanges = draft !== file.content;
  const filename = file.path.split("/").at(-1) ?? file.path;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-[#e8e8e8] border-b bg-[#f7f7f7] pr-3">
        <div className="flex min-w-0 items-stretch self-stretch">
          <div className="flex max-w-[180px] items-center border-[#e8e8e8] border-r px-3 text-[#6f6f6f] text-[12px]">
            <span className="truncate">workspace</span>
          </div>
          <div className="flex max-w-[260px] items-center gap-2 border-[#e8e8e8] border-r bg-white px-3 text-[#1b1b1b] text-[12px]">
            <span className="text-[#f97316]">&lt;&gt;</span>
            <span className="truncate font-medium italic">{filename}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {readOnly ? (
            <span className="font-mono text-[#8a8a8a] text-[9px] uppercase">Read-only</span>
          ) : (
            <ViewModeToggle mode={effectiveMode} onChange={setMode} />
          )}
          {effectiveMode === "edit" ? (
            <button
              className={cn(
                "shrink-0 rounded-full bg-[#1b1b1b] px-3 py-1 font-medium text-[12px] text-white transition-colors hover:bg-black",
                (!hasChanges || isSaving) && "cursor-not-allowed opacity-45",
              )}
              disabled={!hasChanges || isSaving}
              onClick={() => onSave(draft)}
              type="button"
            >
              {isSaving ? "Saving" : "Save"}
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {effectiveMode === "edit" ? (
          <textarea
            className="chat-scrollbar h-full min-h-0 w-full resize-none bg-white p-3 pl-12 font-mono text-[#383a42] text-[12px] leading-5 outline-none"
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            value={draft}
          />
        ) : (
          <FileContentView content={file.content} filename={file.path} />
        )}
      </div>
    </div>
  );
}

function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: FileViewMode;
  onChange: (mode: FileViewMode) => void;
}) {
  return (
    <div className="flex rounded-full bg-thread-surface p-0.5">
      <ViewModeButton
        active={mode === "read"}
        icon={Eye}
        label="View"
        onClick={() => onChange("read")}
      />
      <ViewModeButton
        active={mode === "edit"}
        icon={Pencil}
        label="Edit"
        onClick={() => onChange("edit")}
      />
    </div>
  );
}

function ViewModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "flex h-6 items-center gap-1 rounded-full px-2.5 font-medium text-[11px] transition-colors",
        active
          ? "bg-white text-thread-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
          : "text-thread-text-tertiary hover:text-thread-text-primary",
      )}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {label}
    </button>
  );
}

function BinaryFileMetadata({ path }: { path: string }) {
  return (
    <div className="space-y-4 bg-[#fafafa] p-4">
      <div className="font-mono text-[11px] text-thread-text-muted">Binary file</div>
      <dl className="space-y-2 font-mono text-[11px] text-thread-text-secondary">
        <div>
          <dt className="text-thread-text-tertiary">Path</dt>
          <dd>{path}</dd>
        </div>
        <div>
          <dt className="text-thread-text-tertiary">Preview</dt>
          <dd>Not available — binary content.</dd>
        </div>
      </dl>
    </div>
  );
}

function FilesPlaceholder({ sandboxStatus }: { sandboxStatus: string }) {
  return (
    <div className="grid h-full min-h-[420px] place-items-center rounded-[16px] bg-[#fafafa]">
      <div className="text-center">
        <div className="mx-auto mb-4 h-2 w-2 rounded-full bg-thread-status-warning" />
        <div className="text-[12px] text-thread-text-muted">Files {sandboxStatus}</div>
      </div>
    </div>
  );
}

function FilesError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-3 rounded-[16px] bg-[#fafafa] p-4">
      <div className="font-semibold text-[13px] text-red-700">File unavailable</div>
      <p className="text-sm text-thread-text-secondary">{message}</p>
      <button
        className="rounded-full border border-thread-border px-3 py-2 text-[12px] text-thread-text-secondary hover:bg-thread-hover hover:text-thread-text-primary"
        onClick={onRetry}
        type="button"
      >
        Retry
      </button>
    </div>
  );
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
    onSuccess: (file: SandboxFile) => {
      queryClient.setQueryData<SandboxFile>(sandboxFileQueryKey(threadId, path), file);
      bumpPreviewReloadToken();
      toast.success("File saved");
    },
  });
}
