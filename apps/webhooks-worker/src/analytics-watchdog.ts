import { hmacSha256Base64 } from "@cheatcode/auth";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import type { InternalAlertPayload } from "./internal-alert";

const ANALYTICS_SQL_URL_PREFIX = "https://api.cloudflare.com/client/v4/accounts";

interface AnalyticsSqlResponse {
  data: Record<string, unknown>[];
  rows?: number;
}

interface AnalyticsWatchdogEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_API_TOKEN?: WorkerSecret;
  INTERNAL_ALERT_WEBHOOK_SECRET?: WorkerSecret;
  INTERNAL_ALERT_WEBHOOK_URL?: string;
}

interface WatchdogCheck {
  alert: (rows: Record<string, unknown>[]) => InternalAlertPayload | null;
  name: string;
  query: string;
}

type WatchdogAlertBase = Partial<Omit<InternalAlertPayload, "severity" | "source" | "title">> & {
  title: string;
};

export interface AnalyticsWatchdogResult {
  alertsPosted: number;
  checksRun: number;
}

const WATCHDOG_CHECKS: readonly WatchdogCheck[] = [
  {
    name: "gateway_5xx_ratio_1h",
    query: `
      SELECT
        SUM(if(blob4 = '5xx', _sample_interval, 0)) AS errors,
        SUM(_sample_interval) AS total
      FROM cc_performance_metrics
      WHERE timestamp > NOW() - INTERVAL '1' HOUR
        AND blob1 = 'gateway'
      FORMAT JSON
    `,
    alert: ([row]) =>
      ratioAlert(row, 0.02, {
        description: "Gateway 5xx ratio crossed the 1h burn-rate threshold.",
        route: "/v1/*",
        service: "gateway",
        title: "Gateway 5xx burn-rate breach",
        window: "1h",
        workerName: "gateway",
      }),
  },
  {
    name: "agent_failure_ratio_1h",
    query: `
      SELECT
        SUM(if(blob5 = 'error', _sample_interval, 0)) AS errors,
        SUM(_sample_interval) AS total
      FROM cc_agent_metrics
      WHERE timestamp > NOW() - INTERVAL '1' HOUR
        AND blob7 = 'agent'
      FORMAT JSON
    `,
    alert: ([row]) =>
      ratioAlert(row, 0.06, {
        description: "Agent run failure rate crossed 2x the expected 30-day error budget burn.",
        service: "agent",
        title: "Agent run failure-rate breach",
        window: "1h",
        workerName: "agent",
      }),
  },
  {
    name: "webhook_failures_15m",
    query: `
      SELECT
        blob3 AS route,
        SUM(_sample_interval) AS failures
      FROM cc_error_events
      WHERE timestamp > NOW() - INTERVAL '15' MINUTE
        AND index1 = 'webhooks'
        AND double1 >= 400
      GROUP BY route
      ORDER BY failures DESC
      LIMIT 10
      FORMAT JSON
    `,
    alert: (rows) => webhookFailureAlert(rows),
  },
  {
    name: "ttft_p95_10m",
    query: `
      SELECT
        quantileExactWeighted(0.95)(double1, _sample_interval) AS p95_ms
      FROM cc_performance_metrics
      WHERE timestamp > NOW() - INTERVAL '10' MINUTE
        AND blob1 = 'agent'
        AND double1 > 0
      FORMAT JSON
    `,
    alert: ([row]) =>
      thresholdAlert(row, "p95_ms", 2500, {
        description: "Agent TTFT P95 crossed the 10-minute threshold.",
        service: "agent",
        title: "Agent TTFT P95 breach",
        window: "10m",
        workerName: "agent",
      }),
  },
];

export async function runAnalyticsWatchdog(
  env: AnalyticsWatchdogEnv,
): Promise<AnalyticsWatchdogResult> {
  const token = await analyticsApiToken(env);
  const accountId = accountIdFromEnv(env);
  let alertsPosted = 0;
  let checksRun = 0;
  for (const check of WATCHDOG_CHECKS) {
    const rows = await queryAnalyticsEngine({ accountId, query: check.query, token });
    checksRun += 1;
    const alert = check.alert(rows);
    if (alert) {
      await postWatchdogAlert(env, check.name, alert);
      alertsPosted += 1;
    }
  }
  const costAlert = await costRegressionAlert({ accountId, token });
  checksRun += 1;
  if (costAlert) {
    await postWatchdogAlert(env, "cost_per_run_regression_30m", costAlert);
    alertsPosted += 1;
  }
  return { alertsPosted, checksRun };
}

async function queryAnalyticsEngine(input: {
  accountId: string;
  query: string;
  token: string;
}): Promise<Record<string, unknown>[]> {
  const response = await fetch(
    `${ANALYTICS_SQL_URL_PREFIX}/${input.accountId}/analytics_engine/sql`,
    {
      body: input.query,
      headers: { Authorization: `Bearer ${input.token}` },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new APIError(503, "upstream_provider_outage", "Analytics Engine SQL query failed", {
      details: { status: response.status },
      hint: "Check CLOUDFLARE_ANALYTICS_API_TOKEN permissions for Analytics Engine SQL reads.",
      retriable: true,
    });
  }
  return parseSqlResponse(await response.json()).data;
}

export async function postInternalAlert(
  env: AnalyticsWatchdogEnv,
  alert: InternalAlertPayload,
): Promise<void> {
  const secret = await internalAlertSecret(env);
  const rawBody = JSON.stringify(alert);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await hmacSha256Base64(`${timestamp}.${rawBody}`, secret);
  const response = await fetch(
    env.INTERNAL_ALERT_WEBHOOK_URL ?? "https://webhooks.trycheatcode.com/internal/alert",
    {
      body: rawBody,
      headers: {
        "content-type": "application/json",
        "x-cheatcode-alert-signature": `v1,${signature}`,
        "x-cheatcode-alert-timestamp": timestamp,
      },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new APIError(
      503,
      "upstream_provider_outage",
      "Internal alert webhook rejected watchdog",
      {
        details: { status: response.status },
        hint: "Verify INTERNAL_ALERT_WEBHOOK_SECRET and INTERNAL_ALERT_WEBHOOK_URL.",
        retriable: true,
      },
    );
  }
}

async function postWatchdogAlert(
  env: AnalyticsWatchdogEnv,
  metric: string,
  alert: InternalAlertPayload,
): Promise<void> {
  await postInternalAlert(env, {
    ...alert,
    id: `watchdog_${metric}`,
    metric,
    source: "analytics-watchdog",
    timestamp: new Date().toISOString(),
  });
}

async function costRegressionAlert(input: {
  accountId: string;
  token: string;
}): Promise<InternalAlertPayload | null> {
  const recentRows = await queryAnalyticsEngine({
    ...input,
    query: `
      SELECT
        SUM(double1 * _sample_interval) AS cost_micros,
        count(DISTINCT blob4) AS runs
      FROM cc_cost_events
      WHERE timestamp > NOW() - INTERVAL '30' MINUTE
      FORMAT JSON
    `,
  });
  const baselineRows = await queryAnalyticsEngine({
    ...input,
    query: `
      SELECT
        SUM(double1 * _sample_interval) AS cost_micros,
        count(DISTINCT blob4) AS runs
      FROM cc_cost_events
      WHERE timestamp > NOW() - INTERVAL '7' DAY
        AND timestamp <= NOW() - INTERVAL '30' MINUTE
      FORMAT JSON
    `,
  });
  const recent = costWindow(recentRows[0]);
  const baseline = costWindow(baselineRows[0]);
  if (recent.runs < 3 || baseline.runs < 10 || baseline.avgCostMicros <= 0) {
    return null;
  }
  const ratio = recent.avgCostMicros / baseline.avgCostMicros;
  return ratio > 1.5
    ? {
        description: "Average cost per run crossed 150% of the 7-day baseline.",
        metadata: {
          baselineAvgCostMicros: baseline.avgCostMicros,
          baselineRuns: baseline.runs,
          ratio,
          recentAvgCostMicros: recent.avgCostMicros,
          recentRuns: recent.runs,
        },
        service: "agent",
        severity: ratio > 2 ? "critical" : "warning",
        source: "analytics-watchdog",
        threshold: "150% of 7d baseline",
        title: "Cost-per-run regression",
        window: "30m",
        workerName: "agent",
      }
    : null;
}

function ratioAlert(
  row: Record<string, unknown> | undefined,
  threshold: number,
  base: WatchdogAlertBase,
): InternalAlertPayload | null {
  const errors = numberField(row, "errors");
  const total = numberField(row, "total");
  const ratio = total > 0 ? errors / total : 0;
  return ratio > threshold
    ? {
        ...base,
        metadata: { errors, ratio, total },
        severity: ratio > threshold * 2 ? "critical" : "warning",
        source: "analytics-watchdog",
        threshold: `${threshold}`,
      }
    : null;
}

function webhookFailureAlert(rows: Record<string, unknown>[]): InternalAlertPayload | null {
  const worst = rows.find((row) => numberField(row, "failures") >= 5);
  if (!worst) {
    return null;
  }
  const failures = numberField(worst, "failures");
  const route = stringField(worst, "route") ?? "unknown";
  return {
    description: "Webhook verification or processing failures crossed the 15-minute threshold.",
    metadata: { failures },
    route,
    service: "webhooks",
    severity: failures >= 20 ? "critical" : "warning",
    source: "analytics-watchdog",
    threshold: "5 failures in 15m",
    title: "Webhook failure-rate breach",
    window: "15m",
    workerName: "webhooks",
  };
}

function costWindow(row: Record<string, unknown> | undefined): {
  avgCostMicros: number;
  costMicros: number;
  runs: number;
} {
  const costMicros = numberField(row, "cost_micros");
  const runs = numberField(row, "runs");
  return {
    avgCostMicros: runs > 0 ? costMicros / runs : 0,
    costMicros,
    runs,
  };
}

function thresholdAlert(
  row: Record<string, unknown> | undefined,
  field: string,
  threshold: number,
  base: WatchdogAlertBase,
): InternalAlertPayload | null {
  const value = numberField(row, field);
  return value > threshold
    ? {
        ...base,
        metadata: { [field]: value },
        severity: value > threshold * 1.5 ? "critical" : "warning",
        source: "analytics-watchdog",
        threshold: `${threshold}`,
      }
    : null;
}

function parseSqlResponse(value: unknown): AnalyticsSqlResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new APIError(503, "upstream_provider_outage", "Analytics Engine response was invalid", {
      retriable: true,
    });
  }
  const record = value as Record<string, unknown>;
  const data = Array.isArray(record["data"])
    ? record["data"].filter((row): row is Record<string, unknown> => isRecord(row))
    : [];
  const rows = typeof record["rows"] === "number" ? record["rows"] : undefined;
  return rows === undefined ? { data } : { data, rows };
}

async function analyticsApiToken(env: AnalyticsWatchdogEnv): Promise<string> {
  const token = await readOptionalSecret(
    env.CLOUDFLARE_ANALYTICS_API_TOKEN,
    "CLOUDFLARE_ANALYTICS_API_TOKEN",
  );
  if (!token) {
    throw new APIError(503, "unavailable_maintenance", "Analytics API token is not configured", {
      hint: "Set CLOUDFLARE_ANALYTICS_API_TOKEN on the webhooks Worker.",
      retriable: false,
    });
  }
  return token;
}

async function internalAlertSecret(env: AnalyticsWatchdogEnv): Promise<string> {
  const secret = await readOptionalSecret(
    env.INTERNAL_ALERT_WEBHOOK_SECRET,
    "INTERNAL_ALERT_WEBHOOK_SECRET",
  );
  if (!secret) {
    throw new APIError(503, "unavailable_maintenance", "Internal alert secret is not configured", {
      hint: "Set INTERNAL_ALERT_WEBHOOK_SECRET on the webhooks Worker.",
      retriable: false,
    });
  }
  return secret;
}

async function readOptionalSecret(
  secret: WorkerSecret | undefined,
  name: string,
): Promise<string | undefined> {
  try {
    return await resolveWorkerSecret(secret);
  } catch {
    throw new APIError(503, "unavailable_maintenance", `${name} is unavailable`, {
      hint: `Verify the ${name} Cloudflare Secrets Store binding and secret value.`,
      retriable: false,
    });
  }
}

function accountIdFromEnv(env: AnalyticsWatchdogEnv): string {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!accountId) {
    throw new APIError(503, "unavailable_maintenance", "Cloudflare account id is not configured", {
      hint: "Set CLOUDFLARE_ACCOUNT_ID as a webhooks Worker var.",
      retriable: false,
    });
  }
  return accountId;
}

function numberField(row: Record<string, unknown> | undefined, key: string): number {
  const value = row?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function stringField(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
