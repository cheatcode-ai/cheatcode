"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getGreeting } from "@/lib/api/greeting";

/**
 * Home headline. Defaults to the static "cheatcode ready to build"; once the
 * authenticated greeting resolves a positive daily run-minutes total it renders
 * Cheatcode's dynamic "cheatcode worked {N}m today". Reuses the ["greeting"] query that
 * HomeGreeting already issues (same key + options), so this adds no extra fetch.
 */
export function HomeHeadline() {
  const { getToken, isSignedIn } = useAuth();
  const { data: greeting } = useQuery({
    enabled: Boolean(isSignedIn),
    queryFn: () => getGreeting(getToken),
    queryKey: ["greeting"],
    retry: 0,
    staleTime: 15 * 60_000,
  });
  const workedMinutes = greeting?.workedMinutesToday ?? 0;
  const headline =
    workedMinutes > 0 ? `cheatcode worked ${workedMinutes}m today` : "cheatcode ready to build";
  return (
    <h1 className="mt-1 text-center font-bold text-[20px] leading-7 tracking-[-0.01em] md:text-[24px] md:leading-8">
      {headline}
    </h1>
  );
}
