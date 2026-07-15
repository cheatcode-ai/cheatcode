"use client";

import { normalizeTelemetryPath } from "@cheatcode/types";

/** Returns a useful route identifier without query strings, hashes, or prompt handoff keys. */
export function telemetryPage(): string {
  return normalizeTelemetryPath(window.location.pathname);
}
