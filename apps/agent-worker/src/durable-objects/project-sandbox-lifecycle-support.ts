import type { WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import { DaytonaApiError, type DaytonaSandbox } from "@cheatcode/tools-code";
import { z } from "zod";

export interface ProjectSandboxEnv {
  CHEATCODE_RELEASE_GATE: "closed" | "draining" | "open";
  CHEATCODE_RELEASE_SHA?: string;
  DATABASE_CONTEXT_SIGNING_SECRET_AGENT: WorkerSecret;
  DAYTONA_API_KEY: WorkerSecret;
  DAYTONA_API_URL: string;
  DAYTONA_TARGET: string;
  DAYTONA_SANDBOX_SNAPSHOT: string;
  DAYTONA_WORKSPACE_VOLUME: string;
  HYPERDRIVE: Hyperdrive;
  DAYTONA_ORG_ID?: string;
  DAYTONA_PREVIEW_HOST_SUFFIXES?: string;
  PREVIEW_TOKEN_SECRET: WorkerSecret;
  PREVIEW_HOSTNAME: string;
  QUOTA_TRACKER: DurableObjectNamespace;
  R2_AUDIT: R2Bucket;
  R2_OUTPUTS: R2Bucket;
}

export const ACCOUNT_DELETION_TOMBSTONE_KEY = "account_deletion_tombstone";
export const DAYTONA_ID_KEY = "daytona_sandbox_id";
export const RUN_LEASES_KEY = "run_leases";
export const DEFAULT_IDLE_STOP_MIN = 30;
export const AUTO_ARCHIVE_MIN = 1_440;
export const NEVER_AUTO_DELETE = -1;
export const KEEPALIVE_ALARM_MS = 4 * 60 * 1_000;
export const STALE_RUN_LEASE_MS = 20 * 60 * 1_000;
export const STARTED_REVERIFY_MS = 30_000;
export const ENSURE_STARTED_ATTEMPTS = 30;
export const ENSURE_STARTED_DELAY_MS = 2_000;
export const RunLeasesSchema = z
  .array(z.object({ runId: z.string(), startedMs: z.number() }).strict())
  .default([]);

export function isDaytonaNameConflictError(error: unknown): boolean {
  if (!(error instanceof DaytonaApiError) || error.status !== 409) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("already exists") || message.includes("conflict");
}

export function isStartableState(state: string): boolean {
  return state === "stopped" || state === "archived";
}

export function accountSandboxDeletedError(): APIError {
  return new APIError(
    410,
    "conflict_state_invalid",
    "Sandbox account state is unavailable after deletion started",
    { retriable: false },
  );
}

export function uniqueSandboxes(sandboxes: DaytonaSandbox[]): DaytonaSandbox[] {
  return [...new Map(sandboxes.map((sandbox) => [sandbox.id, sandbox])).values()];
}

export function parseSandboxJson(value: string | null | undefined): unknown {
  try {
    return JSON.parse(value ?? "") as unknown;
  } catch {
    return null;
  }
}

export function sandboxReleaseGateError(): APIError {
  return new APIError(503, "unavailable_maintenance", "Release is in progress", {
    details: { releaseGate: "closed", worker: "agent" },
    retriable: true,
  });
}
