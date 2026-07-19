import { APIError } from "@cheatcode/observability";

const CLOSED_GATE_ALARM_RECHECK_MS = 5 * 60 * 1_000;

interface GatewayDurableObjectEnv {
  CHEATCODE_RELEASE_GATE: "closed" | "open";
}

export function assertGatewayDurableObjectOpen(env: GatewayDurableObjectEnv): void {
  if (env.CHEATCODE_RELEASE_GATE === "closed") {
    throw new Error("Gateway Durable Object is fenced by the closed release gate.");
  }
}

export function gatewayDurableObjectClosedResponse(): Response {
  const response = new APIError(503, "unavailable_maintenance", "Release is in progress", {
    details: { releaseGate: "closed", worker: "gateway" },
    retriable: true,
  }).toResponse(`req_${crypto.randomUUID().replaceAll("-", "")}`);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Retry-After", "5");
  return response;
}

/** Keep cleanup work pending without touching application tables during reconciliation. */
export function rearmClosedGatewayDurableObjectAlarm(ctx: DurableObjectState): Promise<void> {
  return ctx.storage.setAlarm(Date.now() + CLOSED_GATE_ALARM_RECHECK_MS);
}
