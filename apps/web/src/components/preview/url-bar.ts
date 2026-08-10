/**
 * Pure helpers for the preview URL bar. The preview iframe is cross-origin
 * (Daytona preview-proxy host or the local `/__sandbox/<b64host>` proxy route),
 * so we can only know and control the *entry
 * URL* we assign — never the live SPA location after in-app navigation
 * (`contentWindow.location` throws `SecurityError`). The bar shows the last
 * commanded URL, not where the app actually is.
 */

import { PREVIEW_TOKEN_QUERY } from "@/components/preview/preview-protocol";

const SANDBOX_PROXY_PREFIX = "/__sandbox/";

type SplitPreviewUrl = {
  base: string;
  path: string;
};

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
    return stripPreviewCredential(pasted.path);
  }
  return stripPreviewCredential(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
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
    url.searchParams.delete(PREVIEW_TOKEN_QUERY);
    for (const [key, value] of source.searchParams) {
      if (key === PREVIEW_TOKEN_QUERY || !url.searchParams.has(key)) {
        url.searchParams.set(key, value);
      }
    }
    url.searchParams.delete("cc_preview_reload");
    if (reloadToken > 0) {
      url.searchParams.set("cc_preview_reload", String(reloadToken));
    }
    return url.toString();
  } catch {
    return base;
  }
}

function stripPreviewCredential(path: string): string {
  try {
    const parsed = new URL(path, "https://preview.invalid");
    parsed.searchParams.delete(PREVIEW_TOKEN_QUERY);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return path;
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
