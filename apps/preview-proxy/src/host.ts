/**
 * Wildcard preview host parsing.
 *
 * Every preview is served from `{sandboxId}--{port}.{PREVIEW_HOSTNAME}` — a
 * single label below a dedicated preview apex so a one-level wildcard
 * certificate can terminate TLS without sharing the application site.
 * The `--` (double-dash) separator keeps Daytona sandbox ids (which contain
 * single `-` characters, e.g. UUIDs) unambiguous from the trailing port.
 */
const SANDBOX_LABEL_PATTERN = /^([a-z0-9-]+)--(\d{1,5})$/;
const SANDBOX_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

export interface PreviewTarget {
  readonly sandboxId: string;
  readonly port: string;
}

/**
 * Parse `{sandboxId}--{port}.{previewHostname}` into its parts.
 * Returns `null` for any host that is not a well-formed preview host so the
 * caller can reject it with a 400.
 */
export function parsePreviewHost(hostname: string, previewHostname: string): PreviewTarget | null {
  const candidate = canonicalHostname(hostname);
  const apex = canonicalHostname(previewHostname);
  if (!candidate || !apex || candidate === apex || !candidate.endsWith(`.${apex}`)) {
    return null;
  }
  const label = candidate.slice(0, -(apex.length + 1));
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

function canonicalHostname(value: string): string | null {
  const hostname = value.trim().toLowerCase().replace(/\.$/u, "");
  if (!HOSTNAME_PATTERN.test(hostname) || hostname.includes("..")) {
    return null;
  }
  return hostname;
}
