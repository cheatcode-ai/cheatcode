"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { ExternalLink } from "@/components/ui/icons";
import { authorizedFetch } from "@/lib/api/authorized-fetch";
import { cn } from "@/lib/ui/cn";

const TakeoverSessionSchema = z
  .object({
    resumeToken: z.string().min(32).max(200),
    vncUrl: z.string().url(),
  })
  .strict();
const RunStatusSchema = z.object({ runId: z.string().min(1) }).passthrough();

type TakeoverSession = z.infer<typeof TakeoverSessionSchema>;

export function BrowserTakeoverTab({
  sandboxStatus,
  threadId,
}: {
  sandboxStatus: string;
  threadId: string;
}) {
  const { getToken } = useAuth();
  const startMutation = useStartTakeoverMutation(getToken, threadId);
  const resumeMutation = useResumeTakeoverMutation(getToken, threadId, () => startMutation.reset());
  const session = startMutation.data;
  const isBusy = startMutation.isPending || resumeMutation.isPending;

  if (session) {
    return (
      <div className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-[16px] border border-thread-border bg-white">
        <div className="flex h-10 shrink-0 items-center justify-between border-thread-border-subtle border-b px-3">
          <div className="min-w-0 truncate font-semibold text-[13px] text-thread-text-primary">
            Private browser takeover
          </div>
          <div className="ml-3 flex shrink-0 items-center gap-2">
            <a
              aria-label="Open browser takeover in a new tab"
              className="flex h-7 w-7 items-center justify-center rounded-full text-thread-text-secondary transition-colors hover:bg-thread-hover hover:text-thread-text-primary"
              href={session.vncUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            </a>
            <button
              className={cn(
                "h-7 rounded-full border border-thread-border px-3 text-[12px] text-thread-text-secondary transition-colors hover:bg-thread-hover hover:text-thread-text-primary",
                isBusy && "cursor-not-allowed opacity-45",
              )}
              disabled={isBusy}
              onClick={() => resumeMutation.mutate(session.resumeToken)}
              type="button"
            >
              Resume
            </button>
          </div>
        </div>
        <iframe
          className="min-h-0 flex-1 bg-white"
          referrerPolicy="no-referrer"
          sandbox="allow-forms allow-modals allow-popups allow-scripts allow-same-origin"
          src={session.vncUrl}
          title="Browser takeover"
        />
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-[420px] place-items-center rounded-[16px] border border-thread-border bg-[#fafafa]">
      <div className="text-center">
        <div className="mx-auto mb-4 h-2 w-2 rounded-full bg-thread-status-warning" />
        <div className="text-[12px] text-thread-text-muted">Browser {sandboxStatus}</div>
        <button
          className={cn(
            "mt-4 rounded-full border border-thread-border px-4 py-2 text-[12px] text-thread-text-secondary transition-colors hover:bg-thread-hover hover:text-thread-text-primary",
            isBusy && "cursor-not-allowed opacity-45",
          )}
          disabled={isBusy}
          onClick={() => startMutation.mutate()}
          type="button"
        >
          {startMutation.isPending ? "Starting" : "Take Over"}
        </button>
      </div>
    </div>
  );
}

function useStartTakeoverMutation(getToken: () => Promise<null | string>, threadId: string) {
  return useMutation({
    mutationFn: () => startTakeover(getToken, threadId),
    onError: (error) => toast.error(error.message),
  });
}

function useResumeTakeoverMutation(
  getToken: () => Promise<null | string>,
  threadId: string,
  onResumed: () => void,
) {
  return useMutation({
    mutationFn: (resumeToken: string) => resumeTakeover(getToken, threadId, resumeToken),
    onError: (error) => toast.error(error.message),
    onSuccess: () => {
      onResumed();
      toast.success("Agent resumed");
    },
  });
}

async function startTakeover(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<TakeoverSession> {
  const runId = await resolveActiveRunId(getToken, threadId);
  const response = await authorizedFetch(getToken, runTakeoverPath(runId), { method: "POST" });
  return TakeoverSessionSchema.parse(await response.json());
}

async function resumeTakeover(
  getToken: () => Promise<null | string>,
  threadId: string,
  resumeToken: string,
): Promise<void> {
  const runId = await resolveActiveRunId(getToken, threadId);
  await authorizedFetch(getToken, runResumePath(runId), {
    body: JSON.stringify({ resumeToken }),
    method: "POST",
  });
}

async function resolveActiveRunId(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<string> {
  const response = await authorizedFetch(getToken, threadRunStatusPath(threadId));
  if (response.status === 204) {
    throw new Error("No active run is available for browser takeover");
  }
  return RunStatusSchema.parse(await response.json()).runId;
}

function threadRunStatusPath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}/runs/status`;
}

function runTakeoverPath(runId: string): string {
  return `/v1/runs/${encodeURIComponent(runId)}/takeover`;
}

function runResumePath(runId: string): string {
  return `/v1/runs/${encodeURIComponent(runId)}/resume`;
}
