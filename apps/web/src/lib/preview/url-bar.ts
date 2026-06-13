/**
 * Pure helpers for the preview URL bar. The preview iframe is cross-origin
 * (Blaxel host / local `/__sandbox/<b64host>` proxy), so we can only know and
 * control the *entry URL* we assign — never the live SPA location after in-app
 * navigation (`contentWindow.location` throws `SecurityError`). The bar shows
 * the last commanded URL, not where the app actually is (preview-surface §A5).
 */

const SANDBOX_PROXY_PREFIX = "/__sandbox/";

interface SplitPreviewUrl {
  base: string;
  path: string;
}

/** Origin to navigate within. Preserves the local-dev `/__sandbox/<host>` prefix. */
export function previewOrigin(previewUrl: string): string {
  const split = splitPreviewUrl(previewUrl);
  return split === null ? previewUrl : split.base;
}

/**
 * `""` → `/`; `"about"` → `/about`; a pasted full URL is accepted iff it shares
 * the same preview origin (returns its path), otherwise `null` (caller toasts).
 */
export function normalizePreviewPath(input: string, previewUrl: string): null | string {
  const trimmed = input.trim();
  if (trimmed === "") {
    return "/";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const pasted = splitPreviewUrl(trimmed);
    if (pasted === null || pasted.base !== previewOrigin(previewUrl)) {
      return null;
    }
    return pasted.path;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Origin + path, with the existing `cc_preview_reload` token when bumped. */
export function buildPreviewIframeSrc(
  previewUrl: string,
  path: string,
  reloadToken: number,
): string {
  const origin = previewOrigin(previewUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = `${origin}${normalizedPath}`;
  if (reloadToken <= 0) {
    return base;
  }
  try {
    const url = new URL(base);
    url.searchParams.set("cc_preview_reload", String(reloadToken));
    return url.toString();
  } catch {
    return base;
  }
}

function splitPreviewUrl(value: string): null | SplitPreviewUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const prefix = sandboxProxyPrefix(url.pathname);
  const base = prefix === null ? url.origin : `${url.origin}${prefix}`;
  const remainder = prefix === null ? url.pathname : url.pathname.slice(prefix.length);
  const rawPath = `${remainder || "/"}${url.search}`;
  return { base, path: rawPath.startsWith("/") ? rawPath : `/${rawPath}` };
}

function sandboxProxyPrefix(pathname: string): null | string {
  if (!pathname.startsWith(SANDBOX_PROXY_PREFIX)) {
    return null;
  }
  const segment = pathname.slice(SANDBOX_PROXY_PREFIX.length).split("/", 1).at(0);
  return segment ? `${SANDBOX_PROXY_PREFIX}${segment}` : null;
}
