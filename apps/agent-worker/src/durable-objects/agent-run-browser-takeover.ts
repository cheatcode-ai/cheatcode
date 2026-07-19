import { APIError, createLogger } from "@cheatcode/observability";
import {
  BrowserTakeoverResumeResultSchema,
  type BrowserTakeoverSession,
  BrowserTakeoverSessionSchema,
  BrowserTakeoverStatusSchema,
} from "@cheatcode/types";
import type { AgentRunEnv } from "./agent-run-env";
import {
  deleteRunStateValues,
  getRunStateTimestamp,
  getRunStateValue,
  setRunStateValue,
} from "./agent-run-storage";
import { hasActiveRun } from "./run-state";

const TAKEOVER_ID_KEY = "browser_takeover_id";
const TAKEOVER_EXPIRES_AT_KEY = "browser_takeover_expires_at";
const TAKEOVER_TTL_SECONDS = 10 * 60;

interface BrowserTakeoverGateDeps {
  ctx: DurableObjectState;
  env: AgentRunEnv;
  getOwnerUserId: () => string | undefined;
  getStatus: () => string | undefined;
}

/** Durable human-control pause for one run's headed browser. */
export class AgentRunBrowserTakeover {
  private readonly waiters = new Set<() => void>();

  public constructor(private readonly deps: BrowserTakeoverGateDeps) {}

  public async start(userId: string): Promise<Response> {
    const denied = this.ownerError(userId);
    if (denied) return denied;
    if (!hasActiveRun(this.deps.getStatus())) {
      return errorResponse(409, "The agent run is no longer active", "Start a new browser task.");
    }
    const runId = getRunStateValue(this.deps.ctx, "run_id");
    const sandboxName = getRunStateValue(this.deps.ctx, "sandbox_name");
    if (!runId || !sandboxName) {
      return errorResponse(503, "Browser takeover state is incomplete", "Retry in a moment.");
    }
    const current = this.currentState();
    const takeoverId = current?.takeoverId ?? crypto.randomUUID();
    const expiresAtMs = Date.now() + TAKEOVER_TTL_SECONDS * 1_000;
    this.storeActive(takeoverId, expiresAtMs);
    try {
      const sandbox = this.sandbox(sandboxName);
      const session = await sandbox.exposeBrowserTakeover({
        expiresInSeconds: TAKEOVER_TTL_SECONDS,
        runId,
        takeoverId,
      });
      const parsed = BrowserTakeoverSessionSchema.parse({
        ...session,
        status: "active",
      } satisfies BrowserTakeoverSession);
      setRunStateValue(
        this.deps.ctx,
        TAKEOVER_EXPIRES_AT_KEY,
        String(Date.parse(parsed.expiresAt)),
      );
      return Response.json(parsed);
    } catch (error) {
      this.clear();
      if (error instanceof APIError) {
        return error.toResponse(requestId());
      }
      throw error;
    }
  }

  public async status(userId: string): Promise<Response> {
    const denied = this.ownerError(userId);
    if (denied) return denied;
    const state = this.currentState();
    if (!state) {
      return Response.json(BrowserTakeoverStatusSchema.parse({ status: "inactive" }));
    }
    if (state.expiresAtMs <= Date.now()) {
      this.expire();
      return Response.json(BrowserTakeoverStatusSchema.parse({ status: "inactive" }));
    }
    return Response.json(
      BrowserTakeoverStatusSchema.parse({
        expiresAt: new Date(state.expiresAtMs).toISOString(),
        status: "active",
        takeoverId: state.takeoverId,
      }),
    );
  }

  public async resume(userId: string, takeoverId: string): Promise<Response> {
    const denied = this.ownerError(userId);
    if (denied) return denied;
    const state = this.currentState();
    if (!state) {
      return Response.json(
        BrowserTakeoverResumeResultSchema.parse({ ok: true, status: "inactive" }),
      );
    }
    if (state.takeoverId !== takeoverId) {
      return errorResponse(409, "Browser takeover session changed", "Reconnect and try again.");
    }
    await this.stopProcess();
    this.clear();
    return Response.json(BrowserTakeoverResumeResultSchema.parse({ ok: true, status: "inactive" }));
  }

  public async cleanup(): Promise<void> {
    await this.stopProcess().catch((error: unknown) => {
      createLogger().warn("browser_takeover_cleanup_failed", { error });
    });
    this.clear();
  }

  /** Waits without consuming model chunks and returns the human-control duration. */
  public async wait(signal: AbortSignal): Promise<number> {
    const state = this.currentState();
    if (!state) return 0;
    if (state.expiresAtMs <= Date.now()) {
      this.expire();
      return 0;
    }
    const startedAt = Date.now();
    await waitForRelease(this.waiters, state.expiresAtMs - startedAt, signal);
    const current = this.currentState();
    if (current && current.expiresAtMs <= Date.now()) {
      this.expire();
    }
    return Date.now() - startedAt;
  }

  private currentState(): { expiresAtMs: number; takeoverId: string } | null {
    const takeoverId = getRunStateValue(this.deps.ctx, TAKEOVER_ID_KEY);
    const expiresAtMs = getRunStateTimestamp(this.deps.ctx, TAKEOVER_EXPIRES_AT_KEY);
    return takeoverId && expiresAtMs !== null ? { expiresAtMs, takeoverId } : null;
  }

  private storeActive(takeoverId: string, expiresAtMs: number): void {
    setRunStateValue(this.deps.ctx, TAKEOVER_ID_KEY, takeoverId);
    setRunStateValue(this.deps.ctx, TAKEOVER_EXPIRES_AT_KEY, String(expiresAtMs));
  }

  private clear(): void {
    deleteRunStateValues(this.deps.ctx, [TAKEOVER_ID_KEY, TAKEOVER_EXPIRES_AT_KEY]);
    for (const release of this.waiters) release();
    this.waiters.clear();
  }

  private expire(): void {
    this.clear();
    this.deps.ctx.waitUntil(
      this.stopProcess().catch((error: unknown) => {
        createLogger().warn("browser_takeover_expiry_cleanup_failed", { error });
      }),
    );
  }

  private async stopProcess(): Promise<void> {
    const sandboxName = getRunStateValue(this.deps.ctx, "sandbox_name");
    const runId = getRunStateValue(this.deps.ctx, "run_id");
    if (!sandboxName || !runId) return;
    await this.sandbox(sandboxName).stopBrowserTakeover({ runId });
  }

  private sandbox(sandboxName: string) {
    return this.deps.env.PROJECT_SANDBOX.get(this.deps.env.PROJECT_SANDBOX.idFromName(sandboxName));
  }

  private ownerError(userId: string): Response | null {
    if (this.deps.getOwnerUserId() === userId) return null;
    return new APIError(403, "permission_denied", "Run ownership mismatch", {
      retriable: false,
    }).toResponse(requestId());
  }
}

function waitForRelease(
  waiters: Set<() => void>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      waiters.delete(finish);
      resolve();
    };
    waiters.add(finish);
    signal.addEventListener("abort", finish, { once: true });
    timeout = setTimeout(finish, Math.max(0, timeoutMs));
    if (signal.aborted) finish();
  });
}

function errorResponse(status: number, message: string, hint: string): Response {
  return new APIError(status, "conflict_state_invalid", message, {
    hint,
    retriable: status >= 500,
  }).toResponse(requestId());
}

function requestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}
