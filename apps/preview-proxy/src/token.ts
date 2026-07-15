import {
  mintPreviewCapability,
  PreviewCapabilityError,
  type PreviewCapabilityKind,
  type VerifiedPreviewCapability,
  verifyPreviewCapability,
} from "@cheatcode/auth";
import { APIError } from "@cheatcode/observability";
import type { PreviewTarget } from "./host";
import { PREVIEW_SESSION_COOKIE, PREVIEW_TOKEN_QUERY } from "./preview-session";

interface PreviewTokenSource {
  readonly kind: PreviewCapabilityKind;
  readonly token: string;
}

interface AuthorizedPreview {
  readonly fromQuery: boolean;
  readonly verified: VerifiedPreviewCapability;
}

export interface MintedPreviewSession {
  readonly expiresAt: number;
  readonly token: string;
}

/** Query credentials are handoffs; host-only cookie credentials are sessions. */
function readPreviewToken(request: Request, url: URL): PreviewTokenSource | null {
  const queryToken = url.searchParams.get(PREVIEW_TOKEN_QUERY);
  if (queryToken) {
    return { kind: "handoff", token: queryToken };
  }
  const cookieToken = readCookie(request.headers.get("Cookie"), PREVIEW_SESSION_COOKIE);
  if (cookieToken) {
    return { kind: "session", token: cookieToken };
  }
  return null;
}

/** Verify kind, exact preview host, sandbox, port, signature, and lifetime. */
export async function authorizePreviewRequest(input: {
  audience: string;
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
  const verified = await verifyCapability({
    audience: input.audience,
    expectedKind: source.kind,
    secret: input.secret,
    target: input.target,
    token: source.token,
  });
  return { fromQuery: source.kind === "handoff", verified };
}

/** Exchange a short URL handoff for a distinct host-only browser session. */
export async function mintPreviewSessionToken(input: {
  audience: string;
  secret: string;
  target: PreviewTarget;
}): Promise<MintedPreviewSession> {
  const session = await mintPreviewCapability({
    kind: "session",
    secret: input.secret,
    target: capabilityTarget(input.audience, input.target),
  });
  return { expiresAt: session.expiresAt, token: session.token };
}

async function verifyCapability(input: {
  audience: string;
  expectedKind: PreviewCapabilityKind;
  secret: string;
  target: PreviewTarget;
  token: string;
}): Promise<VerifiedPreviewCapability> {
  try {
    return await verifyPreviewCapability({
      expectedKind: input.expectedKind,
      secret: input.secret,
      target: capabilityTarget(input.audience, input.target),
      token: input.token,
    });
  } catch (error) {
    if (error instanceof PreviewCapabilityError && error.reason === "expired") {
      throw new APIError(401, "auth_token_expired", "Preview access token has expired", {
        retriable: false,
      });
    }
    if (error instanceof PreviewCapabilityError) {
      throw invalidToken();
    }
    throw error;
  }
}

function capabilityTarget(audience: string, target: PreviewTarget) {
  return {
    audience,
    port: Number(target.port),
    sandboxId: target.sandboxId,
  };
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
