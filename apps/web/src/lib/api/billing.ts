"use client";

import {
  type ActivityHistoryResponse,
  ActivityHistoryResponseSchema,
  type BillingCancel,
  type BillingCatalogResponse,
  BillingCatalogResponseSchema,
  type BillingCheckout,
  BillingCheckoutSchema,
  type BillingStateResponse,
  BillingStateResponseSchema,
  type BillingSubscriptionActionResponse,
  BillingSubscriptionActionResponseSchema,
  BillingUrlResponseSchema,
  type SandboxUsageSummaryResponse,
  SandboxUsageSummaryResponseSchema,
} from "@cheatcode/types";
import {
  API_RESPONSE_LIMIT_BYTES,
  authorizedFetch,
  readBoundedJsonResponse,
} from "@/lib/api/authorized-fetch";

type GetToken = () => Promise<null | string>;

/** Sandbox-hours usage summary for the header popover and settings meter. */
export async function fetchSandboxUsage(getToken: GetToken): Promise<SandboxUsageSummaryResponse> {
  const response = await authorizedFetch(getToken, "/v1/me/usage");
  return SandboxUsageSummaryResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.billing),
  );
}

/** Plan catalog (tiers, prices, sandbox-hour allowances) resolved server-side. */
export async function fetchBillingCatalog(getToken: GetToken): Promise<BillingCatalogResponse> {
  const response = await authorizedFetch(getToken, "/v1/billing/catalog");
  return BillingCatalogResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.billing),
  );
}

/** Current subscription state for Cheatcode-owned plan management. */
export async function fetchBillingState(getToken: GetToken): Promise<BillingStateResponse> {
  const response = await authorizedFetch(getToken, "/v1/billing/state");
  return BillingStateResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.billing),
  );
}

/** Recent run starts and sandbox-hour activity for the account chart. */
export async function fetchActivityHistory(
  getToken: GetToken,
  days: number,
): Promise<ActivityHistoryResponse> {
  const response = await authorizedFetch(getToken, `/v1/activity?days=${days}`);
  return ActivityHistoryResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.billing),
  );
}

/** Tier-based Polar checkout; the gateway resolves the product id from env. */
export async function requestCheckout(getToken: GetToken, input: BillingCheckout): Promise<string> {
  const body = BillingCheckoutSchema.parse(input);
  const response = await authorizedFetch(getToken, "/v1/billing/checkout", {
    body: JSON.stringify(body),
    method: "POST",
  });
  return BillingUrlResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.billing),
  ).url;
}

/** Schedule the active subscription to cancel at the end of its billing period. */
export async function requestBillingCancellation(
  getToken: GetToken,
  input: BillingCancel,
): Promise<BillingSubscriptionActionResponse> {
  const response = await authorizedFetch(getToken, "/v1/billing/cancel", {
    body: JSON.stringify(input),
    method: "POST",
  });
  return BillingSubscriptionActionResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.billing),
  );
}

/** Keep a subscription that was previously scheduled to cancel. */
export async function requestBillingReactivation(
  getToken: GetToken,
): Promise<BillingSubscriptionActionResponse> {
  const response = await authorizedFetch(getToken, "/v1/billing/reactivate", {
    method: "POST",
  });
  return BillingSubscriptionActionResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.billing),
  );
}
