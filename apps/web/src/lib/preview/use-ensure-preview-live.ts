"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSandboxPreviewStatus, wakeSandboxPreview } from "@/lib/api/project-thread";
import { useAppStore } from "@/lib/store/app-store";

export type PreviewLivePhase = "booting" | "error" | "live";

const STATUS_POLL_MS = 20_000;

/**
 * Keeps the app preview live while the Computer panel is open. Daytona auto-stops a sandbox after
 * idle minutes and preview traffic does NOT reset that timer, so the dev server dies out from
 * under the iframe. On open — and whenever a status poll finds the sandbox stopped mid-view — this
 * wakes it (restart sandbox + dev server) and swaps in the fresh preview URL. The returned phase
 * drives the panel's "Starting preview…" loading state.
 *
 * `active` should be true only when the panel is open AND a preview URL exists (a sleeping app
 * preview to revive) — never for docs/data projects, which have no dev server.
 */
export function useEnsurePreviewLive(
  threadId: string | null,
  getToken: () => Promise<null | string>,
  active: boolean,
): PreviewLivePhase {
  const setPreviewUrl = useAppStore((state) => state.setPreviewUrl);
  const setExpoUrl = useAppStore((state) => state.setExpoUrl);
  const [phase, setPhase] = useState<PreviewLivePhase>("live");
  const wakingRef = useRef(false);

  // Latest deps in a ref so `wake` (and the effects) stay identity-stable — Clerk's getToken is
  // not guaranteed stable across renders, which would otherwise re-fire the wake effect in a loop.
  const depsRef = useRef({ getToken, setExpoUrl, setPreviewUrl, threadId });
  depsRef.current = { getToken, setExpoUrl, setPreviewUrl, threadId };

  const wake = useCallback(async () => {
    const deps = depsRef.current;
    if (!deps.threadId || wakingRef.current) {
      return;
    }
    wakingRef.current = true;
    setPhase("booting");
    try {
      const result = await wakeSandboxPreview(deps.getToken, deps.threadId);
      if (result.url) {
        deps.setPreviewUrl(result.url);
        deps.setExpoUrl(result.expoUrl ?? null);
      }
      setPhase(result.running ? "live" : "error");
    } catch {
      setPhase("error");
    } finally {
      wakingRef.current = false;
    }
  }, []);

  // Wake once when the panel becomes active.
  useEffect(() => {
    if (!active || !threadId) {
      setPhase("live");
      return;
    }
    void wake();
  }, [active, threadId, wake]);

  // While active, poll the sandbox state and auto-wake if it idle-stopped mid-view.
  useEffect(() => {
    if (!active || !threadId) {
      return;
    }
    const id = setInterval(() => {
      void (async () => {
        try {
          const status = await getSandboxPreviewStatus(depsRef.current.getToken, threadId);
          if (!status.running && status.state !== "none" && !wakingRef.current) {
            await wake();
          }
        } catch {
          // Best-effort; the wake path surfaces hard failures.
        }
      })();
    }, STATUS_POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [active, threadId, wake]);

  return phase;
}
