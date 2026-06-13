"use client";

import { authorizedFetch } from "@/lib/api/authorized-fetch";

const FIRST_PREVIEW_OPENED_KEY = "cheatcode:first-preview-opened:v1";

export async function emitFirstPreviewOpened(
  getToken: () => Promise<null | string>,
): Promise<void> {
  if (typeof window === "undefined" || window.localStorage.getItem(FIRST_PREVIEW_OPENED_KEY)) {
    return;
  }
  await authorizedFetch(getToken, "/v1/user-events", {
    body: JSON.stringify({ eventName: "first_preview_opened" }),
    method: "POST",
  });
  window.localStorage.setItem(FIRST_PREVIEW_OPENED_KEY, new Date().toISOString());
}
