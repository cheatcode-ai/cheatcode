"use client";

import { type ProviderKeySummary, ProviderKeySummarySchema } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { authorizedFetch } from "@/lib/api/authorized-fetch";

export const PROVIDER_KEYS_QUERY = ["provider-keys"] as const;

export function useProviderKeysQuery() {
  const { getToken, isSignedIn } = useAuth();
  return useQuery({
    enabled: Boolean(isSignedIn),
    queryFn: async (): Promise<ProviderKeySummary[]> => {
      const response = await authorizedFetch(getToken, "/v1/provider-keys");
      return z
        .array(z.unknown())
        .parse(await response.json())
        .flatMap((row) => {
          const parsed = ProviderKeySummarySchema.safeParse(row);
          return parsed.success ? [parsed.data] : [];
        });
    },
    queryKey: PROVIDER_KEYS_QUERY,
    staleTime: 30_000,
  });
}
