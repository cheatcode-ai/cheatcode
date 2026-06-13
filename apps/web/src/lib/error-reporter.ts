"use client";

import { env } from "@cheatcode/env/web";

const CLIENT_ERROR_ENDPOINT = `${env.NEXT_PUBLIC_GATEWAY_URL}/v1/client-error`;
let initialized = false;

interface ClientErrorPayload {
  message: string;
  stack?: string;
  timestamp: number;
  type?: string;
  url: string;
  userAgent: string;
}

export function reportClientError(error: Error, type: string): void {
  postClientError({
    message: error.message || error.name,
    timestamp: Date.now(),
    type,
    url: location.href,
    userAgent: navigator.userAgent,
    ...(error.stack ? { stack: error.stack } : {}),
  });
}

export function initErrorReporter(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  window.addEventListener("error", (event) => {
    const stack = errorStack(event.error);
    postClientError({
      message: event.message,
      timestamp: Date.now(),
      type: "window-error",
      url: location.href,
      userAgent: navigator.userAgent,
      ...(stack ? { stack } : {}),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const stack = errorStack(event.reason);
    postClientError({
      message: reasonMessage(event.reason),
      timestamp: Date.now(),
      type: "unhandled-rejection",
      url: location.href,
      userAgent: navigator.userAgent,
      ...(stack ? { stack } : {}),
    });
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

function reasonMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message || reason.name;
  }
  if (typeof reason === "string") {
    return reason;
  }
  return "Unhandled rejection";
}

function errorStack(value: unknown): string | undefined {
  return value instanceof Error ? value.stack : undefined;
}
