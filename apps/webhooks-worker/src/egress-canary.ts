import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError, createLogger } from "@cheatcode/observability";
import { z } from "zod";
import { postInternalAlert } from "./analytics-watchdog";
import type { InternalAlertPayload } from "./internal-alert";

/**
 * WS5b egress canary (docs/plans/blaxel-to-daytona-migration.md §WS5b).
 *
 * WS0 verified Daytona egress is currently OPEN on our org, so instead of the
 * (shelved) egress broker we ship a lightweight detector: from a sandbox that is
 * ALREADY running we curl two non-allowlisted hosts. If both become unreachable,
 * Daytona has likely begun enforcing Tier-2 egress limits and we raise a critical
 * alert so the broker (docs/plans/daytona-egress-broker.md) can be deployed.
 *
 * ZERO-COST PIGGYBACK: we never create or start a sandbox just to probe — that
 * would bill a fresh sandbox-hour. We list existing sandboxes and probe one that
 * is already in the `started` state (already billing a real user's run). If none
 * is started this tick we skip the probe (logged) and return — never spinning a
 * sandbox up purely to canary.
 *
 * Daytona REST is hit with raw fetch + zod (mirrors lifecycle-adapters.ts) to keep
 * a @cheatcode/tools-code dependency out of this Worker's bundle.
 */

const DEFAULT_DAYTONA_API_URL = "https://app.daytona.io/api";
/** Toolbox plane base — process/session/fs live here, not under the control API. */
const DEFAULT_DAYTONA_TOOLBOX_URL = "https://proxy.app.daytona.io/toolbox";

/** Label every Cheatcode sandbox is created with (see project-sandbox.ts). */
const CHEATCODE_SANDBOX_LABELS = { app: "cheatcode" } as const;

/** Non-allowlisted hosts the canary curls — egress enforcement would block these. */
const PROBE_HOSTS = ["https://example.com", "https://api.ipify.org"] as const;

/** curl exit codes that signal a network-level block: DNS / connect / timeout. */
const EGRESS_TRIP_EXIT_CODES = new Set([6, 7, 28]);

const CURL_MAX_TIME_SECONDS = 10;
/** Toolbox-side cap; > curl --max-time so curl reports the failure itself. */
const EXECUTE_TIMEOUT_SECONDS = 20;

export interface EgressCanaryEnv {
  DAYTONA_API_KEY?: WorkerSecret | string;
  DAYTONA_API_URL?: string;
  DAYTONA_ORG_ID?: WorkerSecret | string;
  INTERNAL_ALERT_WEBHOOK_SECRET?: WorkerSecret;
  INTERNAL_ALERT_WEBHOOK_URL?: string;
}

export interface EgressCanaryResult {
  alerted: boolean;
  sandboxId: string | null;
  skipped: boolean;
  tripped: boolean;
}

interface HostProbeResult {
  exitCode: number;
  failed: boolean;
  host: string;
  httpCode: number;
}

const SandboxListItemSchema = z
  .object({ id: z.string().min(1), state: z.string().optional() })
  .passthrough();

const SandboxListSchema = z
  .object({ items: z.array(SandboxListItemSchema).default([]) })
  .passthrough()
  .or(z.array(SandboxListItemSchema).transform((items) => ({ items })));

const ExecuteResponseSchema = z
  .object({ exitCode: z.number().int(), result: z.string().nullable().optional() })
  .passthrough();

export async function runEgressCanary(env: EgressCanaryEnv): Promise<EgressCanaryResult> {
  const apiKey = await requireDaytonaApiKey(env);
  const apiUrl = (env.DAYTONA_API_URL ?? DEFAULT_DAYTONA_API_URL).replace(/\/$/, "");
  const orgId = await optionalDaytonaSecret(env.DAYTONA_ORG_ID, "DAYTONA_ORG_ID");

  const sandboxId = await pickStartedSandbox(apiUrl, apiKey, orgId);
  if (!sandboxId) {
    createLogger().info("egress_canary_skipped_no_active_sandbox", {
      labels: CHEATCODE_SANDBOX_LABELS,
    });
    return { alerted: false, sandboxId: null, skipped: true, tripped: false };
  }

  const probes: HostProbeResult[] = [];
  for (const host of PROBE_HOSTS) {
    const probe = await probeHost(apiKey, orgId, sandboxId, host);
    probes.push(probe);
    // One reachable non-allowlisted host already proves egress is open — no need
    // to probe the rest (saves load on the piggybacked user sandbox).
    if (!probe.failed) {
      break;
    }
  }

  const tripped = probes.length === PROBE_HOSTS.length && probes.every((probe) => probe.failed);
  if (!tripped) {
    createLogger().info("egress_canary_ok", { probes: summarizeProbes(probes), sandboxId });
    return { alerted: false, sandboxId, skipped: false, tripped: false };
  }

  await postInternalAlert(env, buildEgressAlert(sandboxId, probes));
  createLogger().warn("egress_canary_tripped", { probes: summarizeProbes(probes), sandboxId });
  return { alerted: true, sandboxId, skipped: false, tripped: true };
}

/** Lists Cheatcode sandboxes and returns the id of one that is already running. */
async function pickStartedSandbox(
  apiUrl: string,
  apiKey: string,
  orgId: string | null,
): Promise<string | null> {
  const labels = encodeURIComponent(JSON.stringify(CHEATCODE_SANDBOX_LABELS));
  const response = await fetch(`${apiUrl}/sandbox?labels=${labels}`, {
    headers: daytonaHeaders(apiKey, orgId),
  });
  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw egressCanaryError("Daytona sandbox list failed", response.status);
  }
  const { items } = SandboxListSchema.parse(await response.json());
  return items.find((item) => item.state === "started")?.id ?? null;
}

/** Runs the curl probe inside the (already running) sandbox via the toolbox plane. */
async function probeHost(
  apiKey: string,
  orgId: string | null,
  sandboxId: string,
  host: string,
): Promise<HostProbeResult> {
  const command = `curl -s -o /dev/null -w "%{http_code}" --max-time ${CURL_MAX_TIME_SECONDS} ${host}`;
  const response = await fetch(
    `${DEFAULT_DAYTONA_TOOLBOX_URL}/${encodeURIComponent(sandboxId)}/process/execute`,
    {
      body: JSON.stringify({ command, timeout: EXECUTE_TIMEOUT_SECONDS }),
      headers: daytonaHeaders(apiKey, orgId, { "Content-Type": "application/json" }),
      method: "POST",
    },
  );
  if (!response.ok) {
    // A toolbox-plane error (e.g. the sandbox stopped mid-tick) is NOT an egress
    // signal — throw so the workflow step retries instead of faking a trip.
    throw egressCanaryError(`Daytona toolbox execute failed for ${host}`, response.status);
  }
  const parsed = ExecuteResponseSchema.parse(await response.json());
  const httpCode = Number.parseInt((parsed.result ?? "").trim(), 10);
  const normalizedHttpCode = Number.isFinite(httpCode) ? httpCode : 0;
  const failed = EGRESS_TRIP_EXIT_CODES.has(parsed.exitCode) || normalizedHttpCode !== 200;
  return { exitCode: parsed.exitCode, failed, host, httpCode: normalizedHttpCode };
}

function buildEgressAlert(sandboxId: string, probes: HostProbeResult[]): InternalAlertPayload {
  return {
    description:
      "Both non-allowlisted canary hosts became unreachable from a running sandbox, " +
      "indicating Daytona began enforcing Tier-2 egress limits. Deploy the shelved " +
      "egress broker (docs/plans/daytona-egress-broker.md).",
    id: "egress-canary",
    metadata: { hosts: summarizeProbes(probes), sandboxId },
    service: "sandbox",
    severity: "critical",
    source: "egress-canary",
    timestamp: new Date().toISOString(),
    title: "Daytona egress enforcement detected",
    workerName: "webhooks",
  };
}

function summarizeProbes(
  probes: HostProbeResult[],
): Array<{ exitCode: number; host: string; httpCode: number }> {
  return probes.map((probe) => ({
    exitCode: probe.exitCode,
    host: probe.host,
    httpCode: probe.httpCode,
  }));
}

function daytonaHeaders(
  apiKey: string,
  orgId: string | null,
  extra?: Record<string, string>,
): Headers {
  const headers = new Headers({ Authorization: `Bearer ${apiKey}`, ...extra });
  if (orgId) {
    headers.set("X-Daytona-Organization-ID", orgId);
  }
  return headers;
}

async function requireDaytonaApiKey(env: EgressCanaryEnv): Promise<string> {
  const value = await optionalDaytonaSecret(env.DAYTONA_API_KEY, "DAYTONA_API_KEY");
  if (!value) {
    throw new APIError(503, "unavailable_maintenance", "DAYTONA_API_KEY is not configured", {
      hint: "Set DAYTONA_API_KEY on the webhooks Worker before running the egress canary.",
      retriable: false,
    });
  }
  return value;
}

async function optionalDaytonaSecret(
  secret: WorkerSecret | string | undefined,
  name: string,
): Promise<string | null> {
  if (!secret) {
    return null;
  }
  if (typeof secret === "string") {
    return secret.trim() ? secret : null;
  }
  try {
    const value = await resolveWorkerSecret(secret);
    return value?.trim() ? value : null;
  } catch {
    throw new APIError(503, "unavailable_maintenance", `${name} is unavailable`, {
      hint: `Verify the ${name} Cloudflare secret binding.`,
      retriable: false,
    });
  }
}

function egressCanaryError(message: string, status: number): APIError {
  return new APIError(503, "upstream_provider_outage", `${message} (HTTP ${status})`, {
    details: { status },
    retriable: true,
  });
}
