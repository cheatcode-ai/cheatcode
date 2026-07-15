"use client";

import { gatewayRequestUrl } from "@/lib/api/gateway-url";
import { telemetryPage } from "@/lib/telemetry-page";

const CLIENT_ERROR_ENDPOINT = gatewayRequestUrl("/v1/client-error");
let initialized = false;

interface ClientErrorPayload {
  timestamp: number;
  type: ClientErrorType;
  url: string;
}

type ClientErrorType =
  | "app-route-error-boundary"
  | "global-error-boundary"
  | "unhandled-rejection"
  | "window-error";

export function reportClientError(type: ClientErrorType): void {
  postClientError({
    timestamp: Date.now(),
    type,
    url: telemetryPage(),
  });
}

export function initErrorReporter(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  window.addEventListener("error", () => {
    reportClientError("window-error");
  });

  window.addEventListener("unhandledrejection", () => {
    reportClientError("unhandled-rejection");
  });
}

function postClientError(payload: ClientErrorPayload): void {
  const body = JSON.stringify(payload);
  const blob = new Blob([body], { type: "application/json" });
  if (navigator.sendBeacon(CLIENT_ERROR_ENDPOINT, blob)) {
    return;
  }
  void fetch(CLIENT_ERROR_ENDPOINT, {
    body,
    headers: { "content-type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => undefined);
}
