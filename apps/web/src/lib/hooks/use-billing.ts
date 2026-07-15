"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchActivityHistory,
  fetchBillingCatalog,
  fetchBillingState,
  fetchSandboxUsage,
} from "@/lib/api/billing";

type GetToken = () => Promise<null | string>;

const SANDBOX_USAGE_QUERY_KEY = ["sandbox-usage"] as const;
const BILLING_CATALOG_QUERY_KEY = ["billing-catalog"] as const;
export const BILLING_STATE_QUERY_KEY = ["billing-state"] as const;

function activityQueryKey(days: number): readonly [string, number] {
  return ["activity", days] as const;
}

/** Live sandbox-hours meter. Refetches on focus since the popover opens after runs. */
export function useSandboxUsageQuery(getToken: GetToken, enabled = true) {
  return useQuery({
    enabled,
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

/** Subscription controls stay dormant until the in-app manager is opened. */
export function useBillingStateQuery(getToken: GetToken, enabled = true) {
  return useQuery({
    enabled,
    queryFn: () => fetchBillingState(getToken),
    queryKey: BILLING_STATE_QUERY_KEY,
    staleTime: 30_000,
  });
}

/** Activity history for the usage chart. */
export function useActivityQuery(getToken: GetToken, days: number) {
  return useQuery({
    queryFn: () => fetchActivityHistory(getToken, days),
    queryKey: activityQueryKey(days),
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
