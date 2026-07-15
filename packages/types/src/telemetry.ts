import { z } from "zod";

const UUID_PATH_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ULID_PATH_SEGMENT = /^[0-9A-HJKMNP-TV-Z]{26}$/iu;
const OPAQUE_PATH_SEGMENT = /^(?:[a-z]+_)?[A-Za-z0-9_-]{32,}$/u;

/** Removes entity identifiers before a path is used as a telemetry dimension. */
export function normalizeTelemetryPath(pathname: string): string {
  const normalized = pathname
    .split("/")
    .map((segment) => (isTelemetryIdentifier(segment) ? ":id" : segment))
    .join("/");
  return (normalized || "/").slice(0, 200);
}

function isTelemetryIdentifier(segment: string): boolean {
  return (
    /^\d+$/u.test(segment) ||
    UUID_PATH_SEGMENT.test(segment) ||
    ULID_PATH_SEGMENT.test(segment) ||
    OPAQUE_PATH_SEGMENT.test(segment)
  );
}

export const ClientErrorBodySchema = z
  .object({
    timestamp: z.number().int().nonnegative(),
    type: z.enum([
      "app-route-error-boundary",
      "global-error-boundary",
      "unhandled-rejection",
      "window-error",
    ]),
    url: z.string().max(2_000).optional(),
  })
  .strict();

const WebVitalMetricSchema = z
  .object({
    attributionTarget: z.string().max(1_000).optional(),
    delta: z.number().finite().optional(),
    id: z.string().max(200),
    name: z.string().max(40),
    navigationType: z.string().max(80).optional(),
    rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
    url: z.string().max(2_000).optional(),
    value: z.number().finite(),
  })
  .strict();

export const WebVitalsBodySchema = z.union([
  WebVitalMetricSchema,
  z.array(WebVitalMetricSchema).min(1).max(20),
]);

const ClientUserEventNameSchema = z.enum([
  "first_preview_opened",
  "console_strip_opened",
  "composer_mention_inserted",
  "composer_repo_attached",
  "composer_slash_inserted",
  "skill_use_clicked",
]);

export const ClientUserEventBodySchema = z
  .object({ eventName: ClientUserEventNameSchema })
  .strict();
