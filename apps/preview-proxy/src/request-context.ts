import { APIError } from "@cheatcode/observability";

const NAVIGATION_DESTINATIONS = new Set(["document", "frame", "iframe"]);

/**
 * Require browser requests that rely on the session cookie to originate from the
 * exact preview origin or an iframe navigation from the trusted app. The app and
 * preview apexes may be cross-site; the exact Referer check is therefore the
 * authority for initial iframe navigation. An explicitly supplied signed query
 * token remains usable for intentional cross-origin/multi-port app traffic.
 */
export function assertPreviewRequestContext(input: {
  fromQuery: boolean;
  request: Request;
  trustedAppOrigin: string;
  trustedPreviewOrigin: string;
  url: URL;
}): void {
  if (input.fromQuery) {
    return;
  }
  const fetchSite = input.request.headers.get("Sec-Fetch-Site")?.toLowerCase();
  // Fetch Metadata is browser-controlled. Checking it before Origin avoids false
  // denials when a local service binding rewrites standard origin headers while
  // preserving the browser's same-origin classification.
  if (fetchSite === "same-origin" || fetchSite === "none") {
    return;
  }
  const origin = input.request.headers.get("Origin");
  if (origin && !isTrustedPreviewOrigin(origin, input)) {
    throw crossOriginDenied();
  }
  if (origin) {
    return;
  }
  const referrerOrigin = readTrustedReferrerOrigin(
    input.request,
    input.url,
    input.trustedAppOrigin,
    input.trustedPreviewOrigin,
  );
  if (!fetchSite) {
    // Older/non-browser clients do not always send Fetch Metadata. Fail closed
    // unless another browser-controlled same-origin/trusted-app signal exists.
    if (origin || referrerOrigin) {
      return;
    }
    throw crossOriginDenied();
  }
  if (isTrustedNavigation(input.request, fetchSite, referrerOrigin)) {
    return;
  }
  throw crossOriginDenied();
}

function isTrustedNavigation(
  request: Request,
  fetchSite: string,
  referrerOrigin: string | null,
): boolean {
  const mode = request.headers.get("Sec-Fetch-Mode")?.toLowerCase();
  const destination = request.headers.get("Sec-Fetch-Dest")?.toLowerCase() ?? "";
  return (
    Boolean(referrerOrigin) &&
    (fetchSite === "same-site" || fetchSite === "cross-site") &&
    mode === "navigate" &&
    NAVIGATION_DESTINATIONS.has(destination)
  );
}

function readTrustedReferrerOrigin(
  request: Request,
  url: URL,
  trustedAppOrigin: string,
  trustedPreviewOrigin: string,
): string | null {
  const referer = request.headers.get("Referer");
  if (!referer) {
    return null;
  }
  try {
    const referrerOrigin = new URL(referer).origin;
    if (
      referrerOrigin === url.origin ||
      referrerOrigin === trustedPreviewOrigin ||
      referrerOrigin === trustedAppOrigin
    ) {
      return referrerOrigin;
    }
  } catch {
    // A malformed referrer is not a trustworthy navigation signal.
  }
  throw crossOriginDenied();
}

function isTrustedPreviewOrigin(
  origin: string,
  input: Pick<Parameters<typeof assertPreviewRequestContext>[0], "trustedPreviewOrigin" | "url">,
): boolean {
  return origin === input.url.origin || origin === input.trustedPreviewOrigin;
}

function crossOriginDenied(): APIError {
  return new APIError(403, "permission_denied", "Cross-origin preview request denied", {
    retriable: false,
  });
}
