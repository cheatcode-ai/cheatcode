import { hmacSha256Base64, timingSafeEqual } from "@cheatcode/auth";
import { APIError } from "@cheatcode/observability";
import type { PreviewTarget } from "./host";

/**
 * Cheatcode preview access token.
 *
 * Wire format: `${sandboxId}.${port}.${exp}.${mode}.${sig}` where
 * `sig = hmacSha256Base64(`${sandboxId}.${port}.${exp}.${mode}`, PREVIEW_TOKEN_SECRET)`
 * (STANDARD base64 — the base64 alphabet has no `.`, so a token always splits
 * into exactly five segments because `sandboxId` is a dot-free DNS label).
 * `exp` is an epoch-millisecond expiry; `mode` is `app`, `code`, or `takeover`.
 */
export type PreviewTokenMode = "app" | "code" | "takeover";

const QUERY_TOKEN_PARAM = "__cc_pt";
const COOKIE_TOKEN_NAME = "cc_pt";
const PREVIEW_TOKEN_MODES = new Set<PreviewTokenMode>(["app", "code", "takeover"]);

export interface VerifiedPreviewToken {
  readonly exp: number;
  readonly mode: PreviewTokenMode;
  readonly port: string;
  readonly raw: string;
  readonly sandboxId: string;
}

export interface PreviewTokenSource {
  readonly fromQuery: boolean;
  readonly token: string;
}

export interface AuthorizedPreview {
  readonly fromQuery: boolean;
  readonly token: string;
  readonly verified: VerifiedPreviewToken;
}

/** Read the access token from the `__cc_pt` query param or the `cc_pt` cookie. */
export function readPreviewToken(request: Request, url: URL): PreviewTokenSource | null {
  const queryToken = url.searchParams.get(QUERY_TOKEN_PARAM);
  if (queryToken) {
    return { fromQuery: true, token: queryToken };
  }
  const cookieToken = readCookie(request.headers.get("Cookie"), COOKIE_TOKEN_NAME);
  if (cookieToken) {
    return { fromQuery: false, token: cookieToken };
  }
  return null;
}

/**
 * Verify the token signature (timing-safe), expiry, and that its
 * `sandboxId`/`port` match the requested host. Throws a 401 `APIError` on any
 * failure (never a redirect). Returns the verified token + how it was supplied.
 */
export async function authorizePreviewRequest(input: {
  request: Request;
  secret: string;
  target: PreviewTarget;
  url: URL;
}): Promise<AuthorizedPreview> {
  const source = readPreviewToken(input.request, input.url);
  if (!source) {
    throw new APIError(401, "auth_token_missing", "Missing preview access token", {
      retriable: false,
    });
  }
  const verified = await verifyPreviewToken(source.token, input.secret);
  if (
    verified.sandboxId.toLowerCase() !== input.target.sandboxId ||
    verified.port !== input.target.port
  ) {
    throw new APIError(401, "auth_token_invalid", "Preview token does not match host", {
      retriable: false,
    });
  }
  return { fromQuery: source.fromQuery, token: source.token, verified };
}

async function verifyPreviewToken(token: string, secret: string): Promise<VerifiedPreviewToken> {
  const parts = token.split(".");
  const [sandboxId, port, expRaw, mode, signature] = parts;
  if (parts.length !== 5 || !sandboxId || !port || !expRaw || !mode || !signature) {
    throw invalidToken();
  }
  if (!isPreviewTokenMode(mode)) {
    throw invalidToken();
  }
  const expected = await hmacSha256Base64(`${sandboxId}.${port}.${expRaw}.${mode}`, secret);
  if (!timingSafeEqual(expected, signature)) {
    throw invalidToken();
  }
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    throw new APIError(401, "auth_token_expired", "Preview access token has expired", {
      retriable: false,
    });
  }
  return { exp, mode, port, raw: token, sandboxId };
}

function isPreviewTokenMode(value: string): value is PreviewTokenMode {
  return PREVIEW_TOKEN_MODES.has(value as PreviewTokenMode);
}

function invalidToken(): APIError {
  return new APIError(401, "auth_token_invalid", "Invalid preview access token", {
    retriable: false,
  });
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const cookie of cookieHeader.split(";")) {
    const trimmed = cookie.trim();
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    if (trimmed.slice(0, separatorIndex) === name) {
      return trimmed.slice(separatorIndex + 1);
    }
  }
  return null;
}
