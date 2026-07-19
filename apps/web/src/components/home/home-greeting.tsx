"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getGreeting } from "@/lib/api/greeting";
import { cn } from "@/lib/ui/cn";

const CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour12: true,
  hour: "numeric",
  minute: "2-digit",
});

interface ClockParts {
  period: string;
  time: string;
}

/**
 * Greeting line above the home headline. Clock is always computed client-side
 * (per directive - the server never returns a clock). When signed in,
 * it appends the gateway greeting (city + rounded temperature) when available and
 * degrades silently to time-only on any failure.
 */
export function HomeGreeting({
  className,
  variant = "desktop",
}: {
  className?: string;
  variant?: "desktop" | "mobile";
}) {
  const { getToken, isSignedIn } = useAuth();
  const clock = useClientClock();
  const { data: greeting } = useQuery({
    enabled: Boolean(isSignedIn),
    queryFn: ({ signal }) => getGreeting(getToken, signal),
    queryKey: ["greeting"],
    retry: 0,
    staleTime: 15 * 60_000,
  });

  if (!clock) {
    return null;
  }
  return <GreetingLine className={className} clock={clock} greeting={greeting} variant={variant} />;
}

function GreetingLine({
  className,
  clock,
  greeting,
  variant,
}: {
  className: string | undefined;
  clock: ClockParts;
  greeting: Awaited<ReturnType<typeof getGreeting>> | undefined;
  variant: "desktop" | "mobile";
}) {
  return (
    <p
      className={cn(
        "flex items-center justify-center text-center",
        variant === "mobile" ? "h-10" : "mt-4 h-6",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-medium text-fg-secondary",
          variant === "mobile" ? "text-[13px] leading-[19.5px]" : "text-[12px] leading-[18px]",
        )}
      >
        <ClockText clock={clock} />
        <GreetingContext greeting={greeting} />
      </span>
    </p>
  );
}

function ClockText({ clock }: { clock: ClockParts }) {
  return (
    <span className="tabular-nums">
      {clock.time}
      {clock.period ? (
        <sup className="ml-px font-medium text-[0.6em] tracking-tight">{clock.period}</sup>
      ) : null}
    </span>
  );
}

function GreetingContext({
  greeting,
}: {
  greeting: Awaited<ReturnType<typeof getGreeting>> | undefined;
}) {
  if (!(greeting?.city || greeting?.weather)) {
    return null;
  }
  return (
    <>
      <span aria-hidden="true" className="text-placeholder">
        ·
      </span>
      {greeting.city ? <span>{greeting.city}</span> : null}
      {greeting.weather ? (
        <>
          <span className="tabular-nums">{Math.round(greeting.weather.tempC)}°</span>
          <WeatherCloudIcon className="size-3.5 shrink-0 opacity-70" />
        </>
      ) : null}
    </>
  );
}

function clockParts(now: Date): ClockParts {
  const parts = CLOCK_FORMATTER.formatToParts(now);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  const period = parts.find((part) => part.type === "dayPeriod")?.value ?? "";
  return { period: period.toUpperCase(), time: `${hour}:${minute}` };
}

function useClientClock(): ClockParts | null {
  const [clock, setClock] = useState<ClockParts | null>(null);
  useEffect(() => {
    const updateClock = () => setClock(clockParts(new Date()));
    updateClock();
    const interval = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(interval);
  }, []);
  return clock;
}

function WeatherCloudIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path d="M17.478 10H17.5a4.5 4.5 0 1 1 0 9H7a5 5 0 0 1-.48-9.977M17.478 10q.022-.247.022-.5a5.5 5.5 0 0 0-10.98-.477M17.478 10a5.5 5.5 0 0 1-1.235 3M6.52 9.023Q6.758 9 7 9a4.98 4.98 0 0 1 3 1" />
    </svg>
  );
}
