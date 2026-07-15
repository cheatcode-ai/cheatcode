"use client";

import { type Provider, type ProviderKeySummary, ProviderKeySummarySchema } from "@cheatcode/types";
import { useMutation, type useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  API_RESPONSE_LIMIT_BYTES,
  authorizedFetch,
  readBoundedJsonResponse,
} from "@/lib/api/authorized-fetch";
import { PROVIDER_KEYS_QUERY } from "@/lib/hooks/use-provider-keys";

type QueryClient = ReturnType<typeof useQueryClient>;

export function useSaveProviderKey(
  getToken: () => Promise<null | string>,
  queryClient: QueryClient,
) {
  return useMutation({
    mutationFn: (input: { key: string; provider: Provider }) =>
      saveProviderKey(getToken, input.provider, input.key),
    onError: (error) => toast.error(error.message),
    onSuccess: (summary) => {
      queryClient.setQueryData<ProviderKeySummary[]>(PROVIDER_KEYS_QUERY, (current) =>
        upsertSummary(current ?? [], summary),
      );
      toast.success("Provider key saved");
    },
  });
}

export function useDeleteProviderKey(
  getToken: () => Promise<null | string>,
  queryClient: QueryClient,
) {
  return useMutation({
    mutationFn: (provider: Provider) => deleteProviderKeyRequest(getToken, provider),
    onError: (error) => toast.error(error.message),
    onSuccess: (_result, provider) => {
      queryClient.setQueryData<ProviderKeySummary[]>(PROVIDER_KEYS_QUERY, (current) =>
        (current ?? []).filter((summary) => summary.provider !== provider),
      );
      toast.success("Provider key deleted");
    },
  });
}

async function saveProviderKey(
  getToken: () => Promise<null | string>,
  provider: Provider,
  key: string,
): Promise<ProviderKeySummary> {
  const response = await authorizedFetch(getToken, "/v1/provider-keys", {
    body: JSON.stringify({ key, provider }),
    method: "POST",
  });
  return ProviderKeySummarySchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.providerKeys),
  );
}

async function deleteProviderKeyRequest(
  getToken: () => Promise<null | string>,
  provider: Provider,
): Promise<void> {
  await authorizedFetch(getToken, `/v1/provider-keys/${provider}`, { method: "DELETE" });
}

function upsertSummary(
  current: ProviderKeySummary[],
  summary: ProviderKeySummary,
): ProviderKeySummary[] {
  const rest = current.filter((item) => item.provider !== summary.provider);
  return [...rest, summary].sort((left, right) => left.provider.localeCompare(right.provider));
}
