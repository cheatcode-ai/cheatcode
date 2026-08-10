"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSandboxPreviewStatus, wakeSandboxPreview } from "@/lib/api/project-thread";
import { type PreviewTab, useAppStore } from "@/lib/store/app-store";

export type PreviewLivePhase = "booting" | "error" | "live";

export interface PreviewLiveState {
  authorizeNavigation: () => Promise<boolean>;
  phase: PreviewLivePhase;
  reload: () => Promise<void>;
  retry: () => Promise<void>;
}

const STATUS_POLL_MS = 20_000;
const STATUS_REQUEST_TIMEOUT_MS = 15_000;
const PREVIEW_SESSION_CHECK_MS = 60_000;
const PREVIEW_SESSION_REFRESH_MS = 8 * 60 * 1000;
const PREVIEW_SESSION_RETRY_MS = 30_000;
// The backend has a 90 s port-start budget. Give it a small response margin, then guarantee the UI
// reaches a retryable terminal state even if an upstream toolbox request stops responding.
const WAKE_REQUEST_TIMEOUT_MS = 105_000;

type PreviewRefreshResult = Awaited<ReturnType<typeof wakeSandboxPreview>>;
type PreviewRefreshOutcome =
  | { kind: "aborted" | "failure" }
  | { kind: "success"; result: PreviewRefreshResult };

interface PreviewRefreshAttempt {
  outcome: PreviewRefreshOutcome;
}

interface PreviewRefreshDependencies {
  bumpPreviewReloadToken: () => void;
  getToken: () => Promise<null | string>;
  setActivePreviewTab: (tab: PreviewTab) => void;
  setExpoUrl: (url: string | null) => void;
  setPreviewUrl: (url: string | null) => void;
  threadId: null | string;
}

interface PreviewLiveRuntime {
  deps: PreviewRefreshDependencies;
  nextRefreshAt: number;
  refreshRequest: Promise<PreviewRefreshAttempt | null> | null;
  requestGeneration: number;
  wakeAbort: AbortController | null;
}

type SetPreviewLivePhase = (phase: PreviewLivePhase) => void;
type PreviewRefreshMode = "authorize" | "recover" | "reload" | "rotate";

/**
 * Keeps the app preview live while the Computer panel is open. Daytona auto-stops a sandbox after
 * idle minutes and preview traffic does NOT reset that timer, so the dev server dies out from
 * under the iframe. On open — and whenever a status poll finds the sandbox stopped mid-view — this
 * wakes it (restart sandbox + dev server) and swaps in the fresh preview URL. The returned phase
 * drives the panel's "Starting preview…" loading state.
 *
 * The authenticated wake response is the only source of preview capabilities. `active` should be
 * true while a project Computer panel is open, including before a URL has been acquired. A project
 * without a tracked dev server is switched to Files without retaining a stale capability.
 */
export function useEnsurePreviewLive(
  threadId: string | null,
  getToken: () => Promise<null | string>,
  active: boolean,
  sandboxStatus: string,
): PreviewLiveState {
  const setActivePreviewTab = useAppStore((state) => state.setActivePreviewTab);
  const bumpPreviewReloadToken = useAppStore((state) => state.bumpPreviewReloadToken);
  const setPreviewUrl = useAppStore((state) => state.setPreviewUrl);
  const setExpoUrl = useAppStore((state) => state.setExpoUrl);
  const [phase, setPhase] = useState<PreviewLivePhase>("live");
  const runtime = usePreviewLiveRuntime(
    bumpPreviewReloadToken,
    getToken,
    setActivePreviewTab,
    setExpoUrl,
    setPreviewUrl,
    threadId,
  );
  const { authorizeNavigation, refreshPreview, reload, wake } = usePreviewRefresh(
    runtime,
    setPhase,
  );

  usePreviewActivation(active, threadId, runtime, setPhase, wake);
  useReadySandboxWake(active, sandboxStatus, wake);
  usePreviewStatusPolling(active, threadId, runtime, wake);
  usePreviewSessionRotation(active, threadId, runtime, refreshPreview);

  return { authorizeNavigation, phase, reload, retry: wake };
}

function usePreviewLiveRuntime(
  bumpPreviewReloadToken: PreviewRefreshDependencies["bumpPreviewReloadToken"],
  getToken: PreviewRefreshDependencies["getToken"],
  setActivePreviewTab: PreviewRefreshDependencies["setActivePreviewTab"],
  setExpoUrl: PreviewRefreshDependencies["setExpoUrl"],
  setPreviewUrl: PreviewRefreshDependencies["setPreviewUrl"],
  threadId: string | null,
): PreviewLiveRuntime {
  const runtimeRef = useRef<PreviewLiveRuntime>({
    deps: {
      bumpPreviewReloadToken,
      getToken,
      setActivePreviewTab,
      setExpoUrl,
      setPreviewUrl,
      threadId,
    },
    nextRefreshAt: 0,
    refreshRequest: null,
    requestGeneration: 0,
    wakeAbort: null,
  });
  // Commit the latest Clerk token getter without restarting the stable wake callback.
  useEffect(() => {
    runtimeRef.current.deps = {
      bumpPreviewReloadToken,
      getToken,
      setActivePreviewTab,
      setExpoUrl,
      setPreviewUrl,
      threadId,
    };
  }, [bumpPreviewReloadToken, getToken, setActivePreviewTab, setExpoUrl, setPreviewUrl, threadId]);
  return runtimeRef.current;
}

function usePreviewRefresh(runtime: PreviewLiveRuntime, setPhase: SetPreviewLivePhase) {
  const authorizeNavigation = useCallback(async () => {
    const result = await refreshPreviewSession(runtime, "authorize", setPhase);
    return Boolean(result?.running && result.url);
  }, [runtime, setPhase]);
  const refreshPreview = useCallback(async () => {
    await refreshPreviewSession(runtime, "rotate", setPhase);
  }, [runtime, setPhase]);
  const reload = useCallback(async () => {
    await refreshPreviewSession(runtime, "reload", setPhase);
  }, [runtime, setPhase]);
  const wake = useCallback(async () => {
    await refreshPreviewSession(runtime, "recover", setPhase);
  }, [runtime, setPhase]);
  return { authorizeNavigation, refreshPreview, reload, wake };
}

async function refreshPreviewSession(
  runtime: PreviewLiveRuntime,
  mode: PreviewRefreshMode,
  setPhase: SetPreviewLivePhase,
): Promise<PreviewRefreshResult | null> {
  const deps = runtime.deps;
  const showBooting = mode === "recover" || mode === "reload";
  if (showBooting) {
    setPhase("booting");
  }
  if (mode === "recover") {
    // Unmount a stale cross-origin document before a real wake. The fresh handoff URL then performs
    // its own cookie exchange on remount; silent capability rotation still preserves live SPA state.
    clearPreviewUrls(deps);
  }
  const attempt = await acquirePreviewRefresh(runtime);
  if (!attempt) return null;
  const refreshDelay = applyPreviewRefreshOutcome(attempt.outcome, deps, showBooting, setPhase);
  if (refreshDelay !== null) runtime.nextRefreshAt = Date.now() + refreshDelay;
  if (attempt.outcome.kind !== "success") return null;
  if (mode === "reload" && attempt.outcome.result.running && attempt.outcome.result.url) {
    deps.bumpPreviewReloadToken();
  }
  return attempt.outcome.result;
}

async function acquirePreviewRefresh(
  runtime: PreviewLiveRuntime,
): Promise<PreviewRefreshAttempt | null> {
  if (runtime.refreshRequest !== null) return runtime.refreshRequest;
  const deps = runtime.deps;
  if (!deps.threadId) return null;
  const requestGeneration = runtime.requestGeneration;
  const controller = new AbortController();
  runtime.wakeAbort = controller;
  const request = requestPreviewRefresh({ ...deps, threadId: deps.threadId }, controller.signal)
    .then((outcome) => (requestGeneration === runtime.requestGeneration ? { outcome } : null))
    .finally(() => finishPreviewRefresh(runtime, request, controller));
  runtime.refreshRequest = request;
  return request;
}

function finishPreviewRefresh(
  runtime: PreviewLiveRuntime,
  request: Promise<PreviewRefreshAttempt | null>,
  controller: AbortController,
): void {
  if (runtime.refreshRequest === request) runtime.refreshRequest = null;
  if (runtime.wakeAbort === controller) runtime.wakeAbort = null;
}

function usePreviewActivation(
  active: boolean,
  threadId: string | null,
  runtime: PreviewLiveRuntime,
  setPhase: SetPreviewLivePhase,
  wake: () => Promise<void>,
): void {
  useEffect(() => {
    cancelPreviewRequest(runtime);
    if (!active || !threadId) {
      setPhase("live");
      runtime.nextRefreshAt = 0;
      clearPreviewUrls(runtime.deps);
      return;
    }
    clearPreviewUrls(runtime.deps);
    void wake();
    return () => cancelPreviewRequest(runtime);
  }, [active, runtime, setPhase, threadId, wake]);
}

function useReadySandboxWake(
  active: boolean,
  sandboxStatus: string,
  wake: () => Promise<void>,
): void {
  useEffect(() => {
    if (active && sandboxStatus === "ready" && useAppStore.getState().previewUrl === null) {
      void wake();
    }
  }, [active, sandboxStatus, wake]);
}

function usePreviewStatusPolling(
  active: boolean,
  threadId: string | null,
  runtime: PreviewLiveRuntime,
  wake: () => Promise<void>,
): void {
  useEffect(() => {
    if (!active || !threadId) return;
    const controller = new AbortController();
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        await pollPreviewStatus({
          getToken: runtime.deps.getToken,
          isWaking: () => runtime.refreshRequest !== null,
          signal: controller.signal,
          threadId,
          wake,
        });
      } finally {
        polling = false;
      }
    };
    const id = setInterval(() => void poll(), STATUS_POLL_MS);
    return () => {
      clearInterval(id);
      controller.abort();
    };
  }, [active, runtime, threadId, wake]);
}

function usePreviewSessionRotation(
  active: boolean,
  threadId: string | null,
  runtime: PreviewLiveRuntime,
  refreshPreview: () => Promise<void>,
): void {
  useEffect(() => {
    if (!active || !threadId) return;
    const id = setInterval(() => {
      if (Date.now() >= runtime.nextRefreshAt) void refreshPreview();
    }, PREVIEW_SESSION_CHECK_MS);
    return () => clearInterval(id);
  }, [active, refreshPreview, runtime, threadId]);
}

function cancelPreviewRequest(runtime: PreviewLiveRuntime): void {
  runtime.requestGeneration += 1;
  runtime.wakeAbort?.abort();
  runtime.wakeAbort = null;
  runtime.refreshRequest = null;
}

function clearPreviewUrls(deps: PreviewRefreshDependencies): void {
  deps.setPreviewUrl(null);
  deps.setExpoUrl(null);
}

async function requestPreviewRefresh(
  deps: PreviewRefreshDependencies & { threadId: string },
  signal: AbortSignal,
): Promise<PreviewRefreshOutcome> {
  try {
    const result = await wakeSandboxPreview(
      deps.getToken,
      deps.threadId,
      AbortSignal.any([signal, AbortSignal.timeout(WAKE_REQUEST_TIMEOUT_MS)]),
    );
    return { kind: "success", result };
  } catch (error) {
    return { kind: isAbortError(error) ? "aborted" : "failure" };
  }
}

async function pollPreviewStatus(input: {
  getToken: () => Promise<null | string>;
  isWaking: () => boolean;
  signal: AbortSignal;
  threadId: string;
  wake: () => Promise<void>;
}): Promise<void> {
  try {
    const status = await getSandboxPreviewStatus(
      input.getToken,
      input.threadId,
      AbortSignal.any([input.signal, AbortSignal.timeout(STATUS_REQUEST_TIMEOUT_MS)]),
    );
    if (!input.signal.aborted && previewStatusNeedsWake(status) && !input.isWaking()) {
      await input.wake();
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    // Best-effort; the wake path surfaces hard failures.
  }
}

function previewStatusNeedsWake(
  status: Awaited<ReturnType<typeof getSandboxPreviewStatus>>,
): boolean {
  const needsCapability = status.running && useAppStore.getState().previewUrl === null;
  const needsWake = !status.running && status.state !== "none";
  return needsCapability || needsWake;
}

function applyPreviewRefreshOutcome(
  outcome: PreviewRefreshOutcome,
  deps: PreviewRefreshDependencies,
  showBooting: boolean,
  setPhase: (phase: PreviewLivePhase) => void,
): number | null {
  if (outcome.kind === "success") {
    return applyPreviewRefreshResult(outcome.result, deps, showBooting, setPhase);
  }
  return outcome.kind === "failure" ? applyPreviewRefreshFailure(showBooting, setPhase) : null;
}

function applyPreviewRefreshResult(
  result: PreviewRefreshResult,
  deps: PreviewRefreshDependencies,
  showBooting: boolean,
  setPhase: (phase: PreviewLivePhase) => void,
): number {
  if (result.url) {
    const shouldActivateApp = useAppStore.getState().previewUrl === null;
    deps.setPreviewUrl(result.url);
    deps.setExpoUrl(result.expoUrl ?? null);
    if (shouldActivateApp) {
      deps.setActivePreviewTab("app");
    }
  } else {
    deps.setPreviewUrl(null);
    deps.setExpoUrl(null);
    deps.setActivePreviewTab("files");
    setPhase("live");
    return PREVIEW_SESSION_REFRESH_MS;
  }
  if (result.running) {
    setPhase("live");
    return PREVIEW_SESSION_REFRESH_MS;
  }
  if (showBooting) {
    setPhase("error");
  }
  return PREVIEW_SESSION_RETRY_MS;
}

function applyPreviewRefreshFailure(
  showBooting: boolean,
  setPhase: (phase: PreviewLivePhase) => void,
): number {
  if (showBooting) {
    setPhase("error");
  }
  return PREVIEW_SESSION_RETRY_MS;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
