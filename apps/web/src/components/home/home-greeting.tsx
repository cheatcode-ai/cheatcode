"use client";

import type { GreetingResponse } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getGreeting } from "@/lib/api/greeting";

/**
 * Greeting line above the home headline. Time-of-day + clock are always computed
 * client-side (per directive — the server never returns a clock). When signed in,
 * it appends the gateway greeting (city + rounded temperature) when available and
 * degrades silently to time-only on any failure.
 */
export function HomeGreeting() {
  const { getToken, isSignedIn } = useAuth();
  const now = useClientClock();
  const greetingQuery = useQuery({
    enabled: Boolean(isSignedIn),
    queryFn: () => getGreeting(getToken),
    queryKey: ["greeting"],
    retry: 0,
    staleTime: 15 * 60_000,
  });

  if (!now) {
    return null;
  }
  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    now,
  );
  return (
    <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.22em]">
      {`${timeOfDay(now)} · ${clock}${weatherSuffix(greetingQuery.data ?? null)}`}
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

function timeOfDay(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 18) {
    return "Good afternoon";
  }
  return "Good evening";
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
