import { APIError, readBoundedResponseJson } from "@cheatcode/observability";
import { z } from "zod";
import type { GatewayEnv } from "./gateway-env";

const MAX_RELEASE_HEALTH_RESPONSE_BYTES = 16 * 1024;
const DownstreamReleaseHealthSchema = z
  .object({
    ok: z.literal(true),
    releaseGate: z.enum(["closed", "draining", "open"]),
    releaseSha: z.string().min(1),
    versionId: z.string().min(1).nullable(),
    worker: z.enum(["agent", "webhooks"]),
  })
  .strict();

export type DownstreamWorker = z.infer<typeof DownstreamReleaseHealthSchema>["worker"];
type DownstreamReleaseHealth = z.infer<typeof DownstreamReleaseHealthSchema>;

export interface DownstreamReleaseHealthResult {
  health: DownstreamReleaseHealth;
  status: number;
}

export async function readDownstreamReleaseHealth(
  env: Pick<GatewayEnv, "AGENT" | "WEBHOOKS">,
  worker: DownstreamWorker,
): Promise<DownstreamReleaseHealthResult> {
  const response = await fetchHealth(env, worker);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw unhealthyService(worker, response.status);
  }
  try {
    const health = DownstreamReleaseHealthSchema.parse(
      await readBoundedResponseJson(
        response,
        MAX_RELEASE_HEALTH_RESPONSE_BYTES,
        `${serviceLabel(worker)} health`,
      ),
    );
    if (health.worker !== worker) {
      throw new Error("Downstream health identified the wrong Worker");
    }
    return { health, status: response.status };
  } catch {
    throw new APIError(
      503,
      "unavailable_maintenance",
      `${serviceLabel(worker)} health response is invalid`,
      { retriable: true },
    );
  }
}

async function fetchHealth(
  env: Pick<GatewayEnv, "AGENT" | "WEBHOOKS">,
  worker: DownstreamWorker,
): Promise<Response> {
  try {
    const binding = worker === "agent" ? env.AGENT : env.WEBHOOKS;
    return await binding.fetch(
      new Request(`https://${worker}.internal/health`, {
        signal: AbortSignal.timeout(3_000),
      }),
    );
  } catch {
    throw new APIError(
      503,
      "unavailable_maintenance",
      `${serviceLabel(worker)} service is unavailable`,
      { retriable: true },
    );
  }
}

function unhealthyService(worker: DownstreamWorker, status: number): APIError {
  return new APIError(
    503,
    "unavailable_maintenance",
    `${serviceLabel(worker)} service is unhealthy`,
    { details: { status }, retriable: true },
  );
}

function serviceLabel(worker: DownstreamWorker): string {
  return worker === "agent" ? "Agent" : "Webhooks";
}
