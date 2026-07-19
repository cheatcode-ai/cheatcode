const DEVELOPMENT_PREVIEW_SESSION_COOKIE = "cc_pt";
const PRODUCTION_PREVIEW_SESSION_COOKIE = "__Host-cc_pt";

export const PREVIEW_SESSION_PATH = "/.well-known/cheatcode-preview-session";
export const PREVIEW_TOKEN_QUERY = "__cc_pt";

export function previewSessionCookieName(environment: "development" | "production"): string {
  return environment === "production"
    ? PRODUCTION_PREVIEW_SESSION_COOKIE
    : DEVELOPMENT_PREVIEW_SESSION_COOKIE;
}

export function isReservedPreviewCookieName(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized === DEVELOPMENT_PREVIEW_SESSION_COOKIE.toLowerCase() ||
    normalized === PRODUCTION_PREVIEW_SESSION_COOKIE.toLowerCase()
  );
}
