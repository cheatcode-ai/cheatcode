"use client";

import { authorizedFetch } from "@/lib/api/authorized-fetch";

const FIRST_PREVIEW_OPENED_KEY = "cheatcode:first-preview-opened:v1";

const swallow = (): void => undefined;

export type ComposerUserEvent =
  | "composer_mention_inserted"
  | "composer_repo_attached"
  | "composer_slash_inserted";

export async function emitFirstPreviewOpened(
  getToken: () => Promise<null | string>,
): Promise<void> {
  if (typeof window === "undefined" || window.localStorage.getItem(FIRST_PREVIEW_OPENED_KEY)) {
    return;
  }
  await postUserEvent(getToken, "first_preview_opened");
  window.localStorage.setItem(FIRST_PREVIEW_OPENED_KEY, new Date().toISOString());
}

/**
 * Fire-and-forget composer telemetry, guarded once-per-session per event name via
 * sessionStorage so it bounds noise (the gateway writeNormal rate limit is the
 * backstop). Never throws into the composer.
 */
export function emitComposerEvent(
  getToken: () => Promise<null | string>,
  eventName: ComposerUserEvent,
): void {
  if (!claimSessionEvent(eventName)) {
    return;
  }
  void postUserEvent(getToken, eventName).catch(swallow);
}

/** Once-per-session, fire-and-forget; mirrors the `first_preview_opened` guard. */
export function emitCommandPaletteOpened(getToken: () => Promise<null | string>): void {
  if (!claimSessionEvent("command_palette_opened")) {
    return;
  }
  void postUserEvent(getToken, "command_palette_opened").catch(swallow);
}

/** Unguarded fire-and-forget — every `Use` click on the skills catalog counts. */
export function emitSkillUseClicked(getToken: () => Promise<null | string>): void {
  void postUserEvent(getToken, "skill_use_clicked").catch(swallow);
}

async function postUserEvent(
  getToken: () => Promise<null | string>,
  eventName: string,
): Promise<void> {
  await authorizedFetch(getToken, "/v1/user-events", {
    body: JSON.stringify({ eventName }),
    method: "POST",
  });
}

function claimSessionEvent(eventName: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const key = `cheatcode:user-event:${eventName}`;
  try {
    if (window.sessionStorage.getItem(key)) {
      return false;
    }
    window.sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}
