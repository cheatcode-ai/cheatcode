/**
 * Wildcard preview host parsing.
 *
 * Every preview is served from `{sandboxId}--{port}.trycheatcode.com` — a single
 * label below the apex so Cloudflare Universal SSL (which covers `*.trycheatcode.com`
 * but not deeper wildcards) terminates TLS for free, no Advanced Certificate needed.
 * The `--` (double-dash) separator keeps Daytona sandbox ids (which contain
 * single `-` characters, e.g. UUIDs) unambiguous from the trailing port.
 */
const PREVIEW_HOST_SUFFIX = ".trycheatcode.com";
const SANDBOX_LABEL_PATTERN = /^([a-z0-9-]+)--(\d{1,5})$/;
const SANDBOX_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface PreviewTarget {
  readonly sandboxId: string;
  readonly port: string;
}

/**
 * Parse `{sandboxId}--{port}.trycheatcode.com` into its parts.
 * Returns `null` for any host that is not a well-formed preview host so the
 * caller can reject it with a 400.
 */
export function parsePreviewHost(host: string): PreviewTarget | null {
  const hostname = (host.split(":")[0] ?? "").toLowerCase();
  if (!hostname.endsWith(PREVIEW_HOST_SUFFIX)) {
    return null;
  }
  const label = hostname.slice(0, hostname.length - PREVIEW_HOST_SUFFIX.length);
  if (!label || label.includes(".")) {
    return null;
  }
  const match = SANDBOX_LABEL_PATTERN.exec(label);
  const sandboxId = match?.[1];
  const port = match?.[2];
  if (!sandboxId || !port || !SANDBOX_ID_PATTERN.test(sandboxId)) {
    return null;
  }
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    return null;
  }
  return { port, sandboxId };
}
