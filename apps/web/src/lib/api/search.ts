"use client";

import { type SearchResponse, SearchResponseSchema } from "@cheatcode/types";
import {
  API_RESPONSE_LIMIT_BYTES,
  authorizedFetch,
  readBoundedJsonResponse,
} from "@/lib/api/authorized-fetch";

export async function searchWorkspace(
  getToken: () => Promise<null | string>,
  query: string,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  const response = await authorizedFetch(getToken, `/v1/search?${params.toString()}`);
  return SearchResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.metadata),
  );
}
