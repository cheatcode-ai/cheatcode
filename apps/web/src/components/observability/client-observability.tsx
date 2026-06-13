"use client";

import { useEffect } from "react";
import { initErrorReporter } from "@/lib/error-reporter";
import { initWebVitals } from "@/lib/rum";

export function ClientObservability() {
  useEffect(() => {
    initWebVitals();
    initErrorReporter();
  }, []);

  return null;
}
