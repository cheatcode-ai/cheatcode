/**
 * Pure helpers for the preview URL bar. The preview iframe is cross-origin
 * (Daytona preview-proxy host or the local `/__sandbox/<b64host>` proxy route),
 * so we can only know and control the *entry
 * URL* we assign — never the live SPA location after in-app navigation
 * (`contentWindow.location` throws `SecurityError`). The bar shows the last
 * commanded URL, not where the app actually is.
 */

const SANDBOX_PROXY_PREFIX = "/__sandbox/";

interface SplitPreviewUrl {
  base: string;
  path: string;
}

/** Origin to navigate within. Preserves the current local proxy's `/__sandbox/<host>` prefix. */
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

/** Origin + path, preserving preview auth and adding `cc_preview_reload` when bumped. */
export function buildPreviewIframeSrc(
  previewUrl: string,
  path: string,
  reloadToken: number,
): string {
  const split = splitPreviewUrl(previewUrl);
  const origin = split?.base ?? previewUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = `${origin}${normalizedPath}`;
  try {
    const url = new URL(base);
    const source = new URL(previewUrl);
    for (const [key, value] of source.searchParams) {
      if (!url.searchParams.has(key)) {
        url.searchParams.set(key, value);
      }
    }
    if (reloadToken > 0) {
      url.searchParams.set("cc_preview_reload", String(reloadToken));
    }
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
