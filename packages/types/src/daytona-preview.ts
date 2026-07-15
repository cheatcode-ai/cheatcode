import { z } from "zod";

const DEFAULT_DAYTONA_PREVIEW_HOST_SUFFIXES = "daytonaproxy01.net,proxy.daytona.work";

const MAX_PREVIEW_URL_LENGTH = 2_048;
const MAX_PREVIEW_TOKEN_LENGTH = 4_096;
const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

const DaytonaPreviewLinkResponseSchema = z
  .object({
    sandboxId: z.string().min(1).max(200).optional(),
    token: z.string().min(1).max(MAX_PREVIEW_TOKEN_LENGTH),
    url: z.url().min(1).max(MAX_PREVIEW_URL_LENGTH),
  })
  .strip();

export interface DaytonaPreviewLink {
  readonly sandboxId?: string;
  readonly token: string;
  readonly url: string;
}

/** Parse the configured comma-separated Daytona preview-domain allowlist. */
export function parseDaytonaPreviewHostSuffixes(
  configured = DEFAULT_DAYTONA_PREVIEW_HOST_SUFFIXES,
): readonly string[] {
  const suffixes = configured
    .split(",")
    .map((suffix) =>
      suffix
        .trim()
        .toLowerCase()
        .replace(/^\.+|\.+$/gu, ""),
    )
    .filter(Boolean);
  if (suffixes.length === 0 || suffixes.length > 16 || !suffixes.every(isValidHostname)) {
    throw new Error("DAYTONA_PREVIEW_HOST_SUFFIXES must contain valid DNS suffixes");
  }
  return [...new Set(suffixes)];
}

/**
 * Validate the control-plane preview response before any browser credential is
 * forwarded to it. This is the shared SSRF boundary for standard and signed
 * Daytona preview links.
 */
export function parseDaytonaPreviewLink(
  value: unknown,
  allowedHostSuffixes: readonly string[],
): DaytonaPreviewLink {
  const parsed = DaytonaPreviewLinkResponseSchema.parse(value);
  const url = new URL(parsed.url);
  const hostname = url.hostname.toLowerCase();
  const isAllowedHost = allowedHostSuffixes.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.port.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    !isAllowedHost
  ) {
    throw new Error("Daytona preview URL failed origin validation");
  }
  return {
    ...(parsed.sandboxId ? { sandboxId: parsed.sandboxId } : {}),
    token: parsed.token,
    url: url.toString(),
  };
}

function isValidHostname(hostname: string): boolean {
  return (
    hostname.length <= 253 &&
    hostname.split(".").every((label) => label.length > 0 && HOSTNAME_LABEL.test(label))
  );
}
