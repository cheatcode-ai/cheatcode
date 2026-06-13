"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchBillingCatalog, fetchSandboxUsage, fetchUsageDaily } from "@/lib/api/billing";

type GetToken = () => Promise<null | string>;

export const SANDBOX_USAGE_QUERY_KEY = ["sandbox-usage"] as const;
export const BILLING_CATALOG_QUERY_KEY = ["billing-catalog"] as const;

export function usageDailyQueryKey(days: number): readonly [string, number] {
  return ["usage-daily", days] as const;
}

/** Live sandbox-hours meter. Refetches on focus since the popover opens after runs. */
export function useSandboxUsageQuery(getToken: GetToken) {
  return useQuery({
    queryFn: () => fetchSandboxUsage(getToken),
    queryKey: SANDBOX_USAGE_QUERY_KEY,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

/** Plan catalog. Static per deploy/session, so it never goes stale within a session. */
export function useBillingCatalogQuery(getToken: GetToken) {
  return useQuery({
    queryFn: () => fetchBillingCatalog(getToken),
    queryKey: BILLING_CATALOG_QUERY_KEY,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Activity history: per-run start timestamps (punchcard points) + legacy totals. */
export function useUsageDailyQuery(getToken: GetToken, days: number) {
  return useQuery({
    queryFn: () => fetchUsageDaily(getToken, days),
    queryKey: usageDailyQueryKey(days),
    staleTime: 60_000,
  });
}

/** Used hours always show one decimal ("0.0"); totals show integers when whole ("60"). */
export function formatHoursUsed(value: number): string {
  return value.toFixed(1);
}

export function formatHoursTotal(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}
