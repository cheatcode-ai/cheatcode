import { z } from "zod";

const INTEGRATION_NAME_MAX_LENGTH = 64;
const INTEGRATION_NAME_PATTERN = /^[a-z0-9_]+$/u;
const INTEGRATION_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  github: "GitHub",
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
  googledocs: "Google Docs",
  googledrive: "Google Drive",
  googlesheets: "Google Sheets",
  linear: "Linear",
  notion: "Notion",
  slack: "Slack",
};

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

/** Stable user-facing label for an open Composio toolkit slug. */
export function integrationDisplayName(slug: IntegrationName): string {
  return (
    INTEGRATION_DISPLAY_NAMES[slug] ??
    slug
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}
