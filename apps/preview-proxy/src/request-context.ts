import { APIError } from "@cheatcode/observability";
import { CHEATCODE_APP_ORIGIN } from "./preview-session";

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
  url: URL;
}): void {
  if (input.fromQuery) {
    return;
  }
  const origin = input.request.headers.get("Origin");
  if (origin && origin !== input.url.origin) {
    throw crossOriginDenied();
  }
  const referrerOrigin = readTrustedReferrerOrigin(input.request, input.url);
  const fetchSite = input.request.headers.get("Sec-Fetch-Site")?.toLowerCase();
  if (!fetchSite) {
    // Older/non-browser clients do not always send Fetch Metadata. Fail closed
    // unless another browser-controlled same-origin/trusted-app signal exists.
    if (origin || referrerOrigin) {
      return;
    }
    throw crossOriginDenied();
  }
  if (fetchSite === "same-origin" || fetchSite === "none" || origin) {
    return;
  }
  const mode = input.request.headers.get("Sec-Fetch-Mode")?.toLowerCase();
  const destination = input.request.headers.get("Sec-Fetch-Dest")?.toLowerCase() ?? "";
  if (
    (fetchSite === "same-site" || fetchSite === "cross-site") &&
    mode === "navigate" &&
    NAVIGATION_DESTINATIONS.has(destination)
  ) {
    if (referrerOrigin) {
      return;
    }
  }
  throw crossOriginDenied();
}

function readTrustedReferrerOrigin(request: Request, url: URL): string | null {
  const referer = request.headers.get("Referer");
  if (!referer) {
    return null;
  }
  try {
    const referrerOrigin = new URL(referer).origin;
    if (referrerOrigin === url.origin || referrerOrigin === CHEATCODE_APP_ORIGIN) {
      return referrerOrigin;
    }
  } catch {
    // A malformed referrer is not a trustworthy navigation signal.
  }
  throw crossOriginDenied();
}

function crossOriginDenied(): APIError {
  return new APIError(403, "permission_denied", "Cross-origin preview request denied", {
    retriable: false,
  });
}
