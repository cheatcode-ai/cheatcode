"use client";

import type { GreetingResponse } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getGreeting } from "@/lib/api/greeting";

const CLOCK_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Greeting line above the home headline. Clock is always computed client-side
 * (per directive - the server never returns a clock). When signed in,
 * it appends the gateway greeting (city + rounded temperature) when available and
 * degrades silently to time-only on any failure.
 */
export function HomeGreeting() {
  const { getToken, isSignedIn } = useAuth();
  const now = useClientClock();
  const { data: greeting } = useQuery({
    enabled: Boolean(isSignedIn),
    queryFn: () => getGreeting(getToken),
    queryKey: ["greeting"],
    retry: 0,
    staleTime: 15 * 60_000,
  });

  if (!now) {
    return null;
  }
  const clock = CLOCK_FORMATTER.format(now).replace(/\s+/g, "");
  return (
    <p className="mt-4 text-center font-medium text-[#1b1b1b] text-[16px] leading-[24px]">
      {`${clock}${weatherSuffix(greeting ?? null)}`}
    </p>
  );
}

function useClientClock(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  return now;
}

function weatherSuffix(data: GreetingResponse | null): string {
  if (!data) {
    return "";
  }
  const parts: string[] = [];
  if (data.city) {
    parts.push(data.city);
  }
  if (data.weather) {
    parts.push(`${Math.round(data.weather.tempC)}°`);
  }
  return parts.length > 0 ? ` · ${parts.join(" ")}` : "";
}
