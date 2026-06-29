"use client";

import type { SandboxFileEntry } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  listSandboxFiles,
  readSandboxFile,
  sandboxFileQueryKey,
  updateSandboxFile,
} from "@/lib/api/sandbox";
import { cn } from "@/lib/ui/cn";

const ENV_ROOT = "/workspace/app";
const ENV_PATH = `${ENV_ROOT}/.env.local`;

export function SandboxEnvTab({
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
  const {
    data: envData,
    error: envError,
    isError: envIsError,
    isPending: envIsPending,
    refetch: refetchEnv,
  } = useQuery({
    enabled: Boolean(previewUrl),
    queryFn: () => loadSandboxEnvFile(getToken, threadId),
    queryKey: sandboxFileQueryKey(threadId, ENV_PATH),
    staleTime: 5_000,
  });
  const saveMutation = useMutation({
    mutationFn: (content: string) => updateSandboxFile(getToken, threadId, ENV_PATH, content),
    onError: (error) => toast.error(error.message),
    onSuccess: (file) => {
      queryClient.setQueryData(sandboxFileQueryKey(threadId, ENV_PATH), {
        content: file.content,
        exists: true,
      });
      toast.success(".env.local saved");
    },
  });

  if (!previewUrl) {
    return <EnvPlaceholder label={`Env ${sandboxStatus}`} />;
  }
  if (envIsError) {
    return <EnvError message={envError.message} onRetry={() => refetchEnv()} />;
  }
  if (envIsPending) {
    return <EnvPlaceholder label="Loading env" />;
  }

  return (
    <EnvEditor
      content={envData.content}
      exists={envData.exists}
      isSaving={saveMutation.isPending}
      onSave={(content) => saveMutation.mutate(content)}
    />
  );
}

function EnvEditor({
  content,
  exists,
  isSaving,
  onSave,
}: {
  content: string;
  exists: boolean;
  isSaving: boolean;
  onSave: (content: string) => void;
}) {
  const [draft, setDraft] = useState(content);
  const hasChanges = draft !== content;

  return (
    <div className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-[16px] border border-thread-border bg-white">
      <div className="flex h-10 shrink-0 items-center justify-between border-thread-border-subtle border-b px-3">
        <div className="min-w-0 truncate font-mono text-[10px] text-thread-text-secondary">
          {ENV_PATH}
        </div>
        <button
          className={cn(
            "ml-3 shrink-0 rounded-full bg-[#1b1b1b] px-3 py-1 font-medium text-[12px] text-white transition-colors hover:bg-black",
            (!hasChanges || isSaving) && "cursor-not-allowed opacity-45",
          )}
          disabled={!hasChanges || isSaving}
          onClick={() => onSave(draft)}
          type="button"
        >
          {isSaving ? "Saving" : exists ? "Save" : "Create"}
        </button>
      </div>
      <div className="border-thread-border-subtle border-b px-3 py-2 font-mono text-[11px] text-thread-text-tertiary">
        {exists ? "Sandbox environment" : "Create sandbox environment file"}
      </div>
      <textarea
        className="chat-scrollbar min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[11px] text-thread-text-secondary leading-5 outline-none"
        onChange={(event) => setDraft(event.target.value)}
        placeholder="NEXT_PUBLIC_API_URL=..."
        spellCheck={false}
        value={draft}
      />
    </div>
  );
}

async function loadSandboxEnvFile(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<{ content: string; exists: boolean }> {
  const listing = await listSandboxFiles(getToken, threadId, ENV_ROOT);
  const envEntry = listing.files.find(isEnvFile);
  if (!envEntry) {
    return { content: "", exists: false };
  }
  const file = await readSandboxFile(getToken, threadId, ENV_PATH);
  return { content: file.content, exists: true };
}

function isEnvFile(entry: SandboxFileEntry): boolean {
  return entry.type === "file" && entry.path === ENV_PATH;
}

function EnvPlaceholder({ label }: { label: string }) {
  return (
    <div className="grid h-full min-h-[420px] place-items-center rounded-[16px] bg-[#fafafa]">
      <div className="text-center">
        <div className="mx-auto mb-4 h-2 w-2 rounded-full bg-thread-status-warning" />
        <div className="text-[12px] text-thread-text-muted">{label}</div>
      </div>
    </div>
  );
}

function EnvError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-3 rounded-[16px] bg-[#fafafa] p-4">
      <div className="font-semibold text-[13px] text-red-700">Env unavailable</div>
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
