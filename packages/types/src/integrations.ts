import { z } from "zod";

export const INTEGRATION_NAME_MAX_LENGTH = 64;
export const INTEGRATION_NAME_PATTERN = /^[a-z0-9_]+$/u;

/** Open Composio toolkit slug, such as `github` or `google_calendar`. */
export const IntegrationNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(INTEGRATION_NAME_MAX_LENGTH)
  .regex(
    INTEGRATION_NAME_PATTERN,
    "Toolkit slug must be lowercase letters, digits, or underscores.",
  );

export type IntegrationName = z.infer<typeof IntegrationNameSchema>;
