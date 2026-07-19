"use client";

import { env } from "@cheatcode/env/web";
import { useEffect, useState } from "react";

const PREVIEW_SESSION_PATH = "/.well-known/cheatcode-preview-session";
const PREVIEW_TOKEN_QUERY = "__cc_pt";
const PREVIEW_HOST_SUFFIX = `.${env.NEXT_PUBLIC_PREVIEW_HOSTNAME}`;
const PREVIEW_HOST_LABEL = /^[a-z0-9]+(?:-[a-z0-9]+)*--\d{1,5}$/u;

interface StablePreviewSource {
  identity: string | null;
  source: string | null;
}

/**
 * Keeps a live iframe mounted when only its short-lived access token rotates.
 * The companion refresh iframe exchanges the new token for the host cookie.
 */
export function useStablePreviewSource(source: string | null): string | null {
  const identity = previewSourceIdentity(source);
  const [stable, setStable] = useState<StablePreviewSource>({ identity, source });
  useEffect(() => {
    setStable((current) => (current.identity === identity ? current : { identity, source }));
  }, [identity, source]);
  return stable.identity === identity ? stable.source : source;
}

/** Refreshes the preview cookie without navigating the visible app/editor iframe. */
export function PreviewSessionRefresh({ previewUrl }: { previewUrl: string | null }) {
  const src = previewSessionRefreshUrl(previewUrl);
  if (!src) {
    return null;
  }
  return (
    <iframe
      aria-hidden="true"
      className="hidden"
      key={src}
      referrerPolicy="no-referrer"
      sandbox="allow-same-origin"
      src={src}
      title="Preview session refresh"
    />
  );
}

function previewSourceIdentity(source: string | null): string | null {
  if (!previewSessionRefreshUrl(source) || !source) {
    return source;
  }
  const parsed = new URL(source);
  parsed.searchParams.delete(PREVIEW_TOKEN_QUERY);
  return parsed.toString();
}

function previewSessionRefreshUrl(previewUrl: string | null): string | null {
  if (!previewUrl) {
    return null;
  }
  try {
    const parsed = new URL(previewUrl);
    const token = parsed.searchParams.get(PREVIEW_TOKEN_QUERY);
    if (!token || !isPreviewProtocol(parsed) || !isPreviewHostname(parsed.hostname)) {
      return null;
    }
    const refresh = new URL(PREVIEW_SESSION_PATH, parsed.origin);
    refresh.searchParams.set(PREVIEW_TOKEN_QUERY, token);
    return refresh.toString();
  } catch {
    return null;
  }
}

function isPreviewProtocol(url: URL): boolean {
  return (
    url.protocol === "https:" ||
    (env.NEXT_PUBLIC_PREVIEW_HOSTNAME === "localhost" && url.protocol === "http:")
  );
}

function isPreviewHostname(hostname: string): boolean {
  if (!hostname.endsWith(PREVIEW_HOST_SUFFIX)) {
    return false;
  }
  const label = hostname.slice(0, -PREVIEW_HOST_SUFFIX.length);
  if (!PREVIEW_HOST_LABEL.test(label)) {
    return false;
  }
  const port = Number(label.slice(label.lastIndexOf("--") + 2));
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}
