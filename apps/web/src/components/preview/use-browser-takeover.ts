"use client";

import type { BrowserTakeoverSession } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  readBrowserTakeoverStatus,
  resumeBrowserAutomation,
  startBrowserTakeover,
} from "@/lib/api/sandbox";

export interface BrowserTakeoverController {
  canTakeOver: boolean;
  isPending: boolean;
  resume: () => Promise<void>;
  session: BrowserTakeoverSession | null;
  start: () => Promise<void>;
}

export function useBrowserTakeover(
  activeRunId: string | null,
  threadId: string,
): BrowserTakeoverController {
  const { getToken } = useAuth();
  const [session, setSession] = useState<BrowserTakeoverSession | null>(null);
  const [isPending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const start = useCallback(async () => {
    if (!activeRunId || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      setSession(await startBrowserTakeover(getToken, threadId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Browser takeover failed");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [activeRunId, getToken, threadId]);

  const resume = useCallback(async () => {
    if (!session || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await resumeBrowserAutomation(getToken, threadId, session.takeoverId);
      setSession(null);
      toast.success("Cheatcode resumed browser control");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Browser automation did not resume");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [getToken, session, threadId]);

  useEffect(() => {
    if (!activeRunId) {
      setSession(null);
      return;
    }
    const abortController = new AbortController();
    void readBrowserTakeoverStatus(getToken, threadId, abortController.signal)
      .then((status) => {
        if (status.status === "active" && !abortController.signal.aborted) void start();
      })
      .catch(() => undefined);
    return () => abortController.abort();
  }, [activeRunId, getToken, start, threadId]);

  useEffect(() => {
    if (!session) return;
    const remainingMs = Date.parse(session.expiresAt) - Date.now();
    if (remainingMs <= 0) {
      setSession(null);
      return;
    }
    const timeout = setTimeout(() => setSession(null), remainingMs);
    return () => clearTimeout(timeout);
  }, [session]);

  return {
    canTakeOver: activeRunId !== null,
    isPending,
    resume,
    session,
    start,
  };
}
