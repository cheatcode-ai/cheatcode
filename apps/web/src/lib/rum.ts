"use client";

import { type BrowserPerformanceMetricNameSchema, normalizeTelemetryPath } from "@cheatcode/types";
import {
  type MetricWithAttribution,
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
} from "web-vitals/attribution";
import type { z } from "zod";
import { gatewayRequestUrl } from "@/lib/api/gateway-url";

const VITALS_ENDPOINT = gatewayRequestUrl("/v1/vitals");
const queue = new Set<WebVitalPayload>();
let initialized = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export type BrowserPerformanceMetricName = z.infer<typeof BrowserPerformanceMetricNameSchema>;

interface WebVitalPayload {
  attributionTarget?: string;
  delta: number;
  id: string;
  name: string;
  navigationType?: string;
  rating?: "good" | "needs-improvement" | "poor";
  url: string;
  value: number;
}

export function initWebVitals(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  onCLS(report);
  onINP(report);
  onLCP(report);
  onFCP(report);
  onTTFB(report);

  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  });
  addEventListener("pagehide", flush);
}

/** Records an anonymous, bounded product milestone using the Web Vitals delivery path. */
export function reportBrowserPerformanceMetric(
  name: Exclude<BrowserPerformanceMetricName, "CLS" | "FCP" | "INP" | "LCP" | "TTFB">,
  value: number,
): void {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }
  queue.add({
    delta: value,
    id: `${name}-${Date.now().toString(36)}-${crypto.randomUUID()}`,
    name,
    url: normalizeTelemetryPath(window.location.pathname),
    value,
  });
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer !== null) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 1_000);
}

function report(metric: MetricWithAttribution): void {
  const target = attributionTarget(metric);
  queue.add({
    delta: metric.delta,
    id: metric.id,
    name: metric.name,
    navigationType: metric.navigationType,
    rating: metric.rating,
    url: normalizeTelemetryPath(window.location.pathname),
    value: metric.value,
    ...(target ? { attributionTarget: target } : {}),
  });
}

function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.size === 0) {
    return;
  }
  const batch = [...queue];
  for (const payload of batch) {
    queue.delete(payload);
  }

  const body = JSON.stringify(batch);
  const blob = new Blob([body], { type: "application/json" });
  if (navigator.sendBeacon(VITALS_ENDPOINT, blob)) {
    return;
  }
  void fetch(VITALS_ENDPOINT, {
    body,
    headers: { "content-type": "application/json" },
    keepalive: true,
    method: "POST",
  })
    .then((response) => {
      if (!response.ok) {
        requeue(batch);
      }
    })
    .catch(() => {
      requeue(batch);
    });
}

function requeue(batch: readonly WebVitalPayload[]): void {
  for (const payload of batch) {
    queue.add(payload);
  }
}

function attributionTarget(metric: MetricWithAttribution): string | undefined {
  switch (metric.name) {
    case "CLS":
      return metric.attribution.largestShiftTarget;
    case "INP":
      return metric.attribution.interactionTarget;
    case "LCP":
      return metric.attribution.target;
    case "FCP":
    case "TTFB":
      return undefined;
  }
}
