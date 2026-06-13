"use client";

import { env } from "@cheatcode/env/web";
import {
  type MetricWithAttribution,
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
} from "web-vitals/attribution";

const VITALS_ENDPOINT = `${env.NEXT_PUBLIC_GATEWAY_URL}/v1/vitals`;
const queue = new Set<WebVitalPayload>();
let initialized = false;

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

function report(metric: MetricWithAttribution): void {
  const target = attributionTarget(metric);
  queue.add({
    delta: metric.delta,
    id: metric.id,
    name: metric.name,
    navigationType: metric.navigationType,
    rating: metric.rating,
    url: location.href,
    value: metric.value,
    ...(target ? { attributionTarget: target } : {}),
  });
}

function flush(): void {
  if (queue.size === 0) {
    return;
  }
  const body = JSON.stringify([...queue]);
  const blob = new Blob([body], { type: "application/json" });
  if (navigator.sendBeacon(VITALS_ENDPOINT, blob)) {
    queue.clear();
    return;
  }
  void fetch(VITALS_ENDPOINT, {
    body,
    headers: { "content-type": "application/json" },
    keepalive: true,
    method: "POST",
  })
    .then(() => {
      queue.clear();
    })
    .catch(() => undefined);
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
