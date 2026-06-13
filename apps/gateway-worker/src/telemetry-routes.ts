import {
  APIError,
  createLogger,
  emitErrorEvent,
  emitPerformanceMetric,
  emitUserEvent,
} from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import type { Context } from "hono";
import { z } from "zod";
import type { GatewayEnv } from "./index";

type GatewayContext = Context<{ Bindings: GatewayEnv }>;
type TelemetryUserResolver = (
  request: Request,
  env: GatewayEnv,
  ctx: ExecutionContext,
) => Promise<UserId | "anonymous">;

const MAX_TELEMETRY_BODY_CHARS = 16 * 1024;

const ClientErrorBodySchema = z
  .object({
    message: z.string().max(2000).default("Client error"),
    stack: z.string().max(8000).optional(),
    timestamp: z.number().int().nonnegative().optional(),
    type: z.string().max(120).optional(),
    url: z.string().max(2000).optional(),
    userAgent: z.string().max(1000).optional(),
  })
  .strict();

const WebVitalMetricSchema = z
  .object({
    attributionTarget: z.string().max(1000).optional(),
    delta: z.number().finite().optional(),
    id: z.string().max(200),
    name: z.string().max(40),
    navigationType: z.string().max(80).optional(),
    rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
    url: z.string().max(2000).optional(),
    value: z.number().finite(),
  })
  .strict();

const WebVitalsBodySchema = z.union([
  WebVitalMetricSchema,
  z.array(WebVitalMetricSchema).min(1).max(20),
]);
const ClientUserEventBodySchema = z
  .object({
    eventName: z.enum(["first_preview_opened"]),
  })
  .strict();

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
  createLogger({
    requestId: id,
    ...(userId === "anonymous" ? {} : { userId }),
  }).error("client_error", {
    message: parsed.data.message,
    stack: parsed.data.stack,
    type: parsed.data.type ?? "frontend",
    url: parsed.data.url,
    userAgent: parsed.data.userAgent,
  });
  emitErrorEvent(c.env, {
    errorCategory: "frontend",
    errorCode: parsed.data.type ?? "client_error",
    message: parsed.data.message,
    route: pathFromUrl(parsed.data.url) ?? "/v1/client-error",
    userId,
    workerName: "web",
    ...(parsed.data.stack ? { stack: parsed.data.stack } : {}),
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
  const text = await request.text();
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
    return new URL(value).pathname;
  } catch {
    return value.slice(0, 200);
  }
}
