import {
  APIError,
  createLogger,
  emitErrorEvent,
  emitPerformanceMetric,
  emitUserEvent,
  readBoundedRequestText,
  safeErrorTelemetry,
} from "@cheatcode/observability";
import {
  ClientErrorBodySchema,
  ClientUserEventBodySchema,
  normalizeTelemetryPath,
  type UserId,
  WebVitalsBodySchema,
} from "@cheatcode/types";
import type { Context } from "hono";
import type { z } from "zod";
import type { GatewayEnv } from "./gateway-env";
import type { WaitUntilContext } from "./wait-until-context";

type GatewayContext = Context<{ Bindings: GatewayEnv }>;
type TelemetryUserResolver = (
  request: Request,
  env: GatewayEnv,
  ctx: WaitUntilContext,
) => Promise<UserId | "anonymous">;

const MAX_TELEMETRY_BODY_CHARS = 16 * 1024;
const MAX_TELEMETRY_BODY_BYTES = 64 * 1024;

export async function clientErrorRoute(
  c: GatewayContext,
  resolveTelemetryUser: TelemetryUserResolver,
) {
  const id = c.req.header("X-Request-Id") ?? requestId();
  const parsed = ClientErrorBodySchema.safeParse(await readTelemetryJson(c.req.raw));
  if (!parsed.success) {
    throw invalidTelemetryPayload(parsed.error);
  }
  const userId = await resolveTelemetryUser(c.req.raw, c.env, c.executionCtx);
  const route = pathFromUrl(parsed.data.url) ?? "/v1/client-error";
  const telemetry = safeErrorTelemetry({ name: parsed.data.type ?? "FrontendError" });
  createLogger({
    requestId: id,
    ...(userId === "anonymous" ? {} : { userId }),
  }).error("client_error", {
    url: route,
    ...telemetry,
  });
  emitErrorEvent(c.env, {
    errorCategory: "frontend",
    errorCode: "client_error",
    route,
    userId,
    workerName: "web",
    ...telemetry,
  });
  return c.json({ ok: true });
}

export async function vitalsRoute(c: GatewayContext) {
  const parsed = WebVitalsBodySchema.safeParse(await readTelemetryJson(c.req.raw));
  if (!parsed.success) {
    throw invalidTelemetryPayload(parsed.error);
  }
  const metrics = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  for (const metric of metrics) {
    emitPerformanceMetric(c.env, {
      metricName: metric.name,
      route: pathFromUrl(metric.url) ?? "browser",
      statusClass: metric.rating ?? "unknown",
      totalMs: metric.value,
      workerName: "web",
    });
  }
  return c.json({ ok: true });
}

export async function clientUserEventRoute(
  c: GatewayContext,
  resolveTelemetryUser: TelemetryUserResolver,
) {
  const parsed = ClientUserEventBodySchema.safeParse(await readTelemetryJson(c.req.raw));
  if (!parsed.success) {
    throw invalidTelemetryPayload(parsed.error);
  }
  const userId = await resolveTelemetryUser(c.req.raw, c.env, c.executionCtx);
  if (userId === "anonymous") {
    throw new APIError(401, "permission_denied", "Authentication is required for user events", {
      retriable: false,
    });
  }
  emitUserEvent(c.env, {
    eventName: parsed.data.eventName,
    userId,
  });
  return c.json({ ok: true });
}

function requestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function readTelemetryJson(request: Request): Promise<unknown> {
  const text = await readBoundedRequestText(request, MAX_TELEMETRY_BODY_BYTES, "Telemetry request");
  if (text.length > MAX_TELEMETRY_BODY_CHARS) {
    throw new APIError(400, "invalid_request_body", "Telemetry payload is too large", {
      retriable: false,
    });
  }
  if (text.trim().length === 0) {
    throw new APIError(400, "invalid_request_body", "Telemetry payload is empty", {
      retriable: false,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new APIError(400, "invalid_request_body", "Telemetry payload must be JSON", {
      retriable: false,
    });
  }
}

function invalidTelemetryPayload(error: z.ZodError): APIError {
  return new APIError(400, "invalid_request_body", "Invalid telemetry payload", {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}

function pathFromUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = new URL(value, "https://telemetry.invalid");
    if (parsed.origin !== "https://telemetry.invalid" && !/^https?:$/.test(parsed.protocol)) {
      return undefined;
    }
    return normalizeTelemetryPath(parsed.pathname);
  } catch {
    return undefined;
  }
}
