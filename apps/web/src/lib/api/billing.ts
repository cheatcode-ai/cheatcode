"use client";

import {
  type BillingCatalogResponse,
  BillingCatalogResponseSchema,
  type BillingCheckout,
  BillingCheckoutSchema,
  BillingUrlResponseSchema,
  type SandboxUsageSummaryResponse,
  SandboxUsageSummaryResponseSchema,
  type UsageDailyTotalsResponse,
  UsageDailyTotalsResponseSchema,
} from "@cheatcode/types";
import { authorizedFetch } from "@/lib/api/authorized-fetch";

type GetToken = () => Promise<null | string>;

/** Sandbox-hours usage summary for the header popover and settings meter. */
export async function fetchSandboxUsage(getToken: GetToken): Promise<SandboxUsageSummaryResponse> {
  const response = await authorizedFetch(getToken, "/v1/me/usage");
  return SandboxUsageSummaryResponseSchema.parse(await response.json());
}

/** Plan catalog (tiers, prices, sandbox-hour allowances) resolved server-side. */
export async function fetchBillingCatalog(getToken: GetToken): Promise<BillingCatalogResponse> {
  const response = await authorizedFetch(getToken, "/v1/billing/catalog");
  return BillingCatalogResponseSchema.parse(await response.json());
}

/** Daily usage history: per-run start timestamps (punchcard) + legacy cost/token totals. */
export async function fetchUsageDaily(
  getToken: GetToken,
  days: number,
): Promise<UsageDailyTotalsResponse> {
  const response = await authorizedFetch(getToken, `/v1/usage/daily?days=${days}`);
  return UsageDailyTotalsResponseSchema.parse(await response.json());
}

/** Tier-based Polar checkout; the gateway resolves the product id from env. */
export async function requestCheckout(getToken: GetToken, input: BillingCheckout): Promise<string> {
  const body = BillingCheckoutSchema.parse(input);
  const response = await authorizedFetch(getToken, "/v1/billing/checkout", {
    body: JSON.stringify(body),
    method: "POST",
  });
  return BillingUrlResponseSchema.parse(await response.json()).url;
}
