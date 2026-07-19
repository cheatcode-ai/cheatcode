"use client";

import { type ProviderKeySummary, ProviderKeySummarySchema } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import {
  API_RESPONSE_LIMIT_BYTES,
  authorizedFetch,
  readBoundedJsonResponse,
} from "@/lib/api/authorized-fetch";

export const PROVIDER_KEYS_QUERY = ["provider-keys"] as const;

export function useProviderKeysQuery() {
  const { getToken, isSignedIn } = useAuth();
  return useQuery({
    enabled: Boolean(isSignedIn),
    queryFn: async ({ signal }): Promise<ProviderKeySummary[]> => {
      const response = await authorizedFetch(getToken, "/v1/provider-keys", { signal });
      return ProviderKeySummarySchema.array().parse(
        await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.providerKeys),
      );
    },
    queryKey: PROVIDER_KEYS_QUERY,
    staleTime: 30_000,
  });
}
