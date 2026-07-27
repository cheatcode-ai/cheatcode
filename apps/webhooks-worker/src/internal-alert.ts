import {
  type AnalyticsBindings,
  createLogger,
  emitErrorEvent,
  redactSecrets,
} from "@cheatcode/observability";
import { z } from "zod";

const InternalAlertPayloadSchema = z
  .object({
    description: z.string().trim().min(1).max(4_000).optional(),
    id: z.string().trim().min(1).max(160),
    metadata: z.record(z.string(), z.unknown()).optional(),
    metric: z.string().trim().min(1).max(160).optional(),
    route: z.string().trim().min(1).max(240).optional(),
    runId: z.string().trim().min(1).max(160).optional(),
    service: z.string().trim().min(1).max(160).optional(),
    severity: z.enum(["info", "warning", "critical"]).default("warning"),
    source: z.string().trim().min(1).max(160),
    threshold: z.string().trim().min(1).max(500).optional(),
    timestamp: z.string().trim().min(1).max(80).optional(),
    title: z.string().trim().min(1).max(240),
    userId: z.string().trim().min(1).max(160).optional(),
    window: z.string().trim().min(1).max(160).optional(),
    workerName: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export type InternalAlertPayload = z.infer<typeof InternalAlertPayloadSchema>;

export interface VerifiedInternalAlert extends InternalAlertPayload {
  alertId: string;
}

export const VerifiedInternalAlertSchema = InternalAlertPayloadSchema.extend({
  alertId: z.string().trim().min(1).max(160),
});

/** Validate and redact a Worker-owned alert before durable ingestion. */
export function prepareInternalAlert(input: InternalAlertPayload): VerifiedInternalAlert {
  const payload = InternalAlertPayloadSchema.parse(redactSecrets(input));
  return VerifiedInternalAlertSchema.parse({
    ...payload,
    alertId: payload.id,
  });
}

/** Deterministic delivery identity: an exact retry dedupes, while a changed alert is a new event. */
export async function internalAlertEventId(rawBody: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `alert_${hash}`;
}

/** Record a verified alert from the durable webhook workflow. */
export function recordInternalAlert(env: AnalyticsBindings, alert: VerifiedInternalAlert): void {
  createLogger().warn("internal_alert_received", {
    alertId: alert.alertId,
    metric: alert.metric,
    route: alert.route,
    runId: alert.runId,
    service: alert.service,
    severity: alert.severity,
    source: alert.source,
    userId: alert.userId,
    workerName: alert.workerName,
  });
  emitErrorEvent(env, {
    errorCategory: "ops_alert",
    errorCode: alert.source,
    workerName: alert.workerName ?? "webhooks",
    ...(alert.route ? { route: alert.route } : {}),
    ...(alert.runId ? { runId: alert.runId } : {}),
    ...(alert.userId ? { userId: alert.userId } : {}),
  });
}
