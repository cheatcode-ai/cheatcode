import { APIError } from "@cheatcode/observability";

const CLOSED_GATE_ALARM_RECHECK_MS = 5 * 60 * 1_000;

export interface ReleaseGateBindings {
  CHEATCODE_RELEASE_GATE: "closed" | "draining" | "open";
  CHEATCODE_RELEASE_SHA?: string;
}

export function assertReleaseOpen(env: ReleaseGateBindings): void {
  if (env.CHEATCODE_RELEASE_GATE !== "open") {
    throw releaseGateError(env.CHEATCODE_RELEASE_GATE);
  }
}

export function assertReleaseCanDrain(env: ReleaseGateBindings): void {
  if (env.CHEATCODE_RELEASE_GATE === "closed") {
    throw releaseGateError("closed");
  }
}

export function releaseGateError(releaseGate: "closed" | "draining" = "closed"): APIError {
  return new APIError(503, "unavailable_maintenance", "Release is in progress", {
    details: { releaseGate, worker: "webhooks" },
    retriable: true,
  });
}

/** Preserve TTL cleanup without reading application tables during a closed release. */
export function rearmClosedWebhookAlarm(ctx: DurableObjectState): Promise<void> {
  return ctx.storage.setAlarm(Date.now() + CLOSED_GATE_ALARM_RECHECK_MS);
}
