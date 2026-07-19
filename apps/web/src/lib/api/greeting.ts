"use client";

import { type GreetingResponse, GreetingResponseSchema } from "@cheatcode/types";
import {
  API_RESPONSE_LIMIT_BYTES,
  authorizedFetch,
  readBoundedJsonResponse,
} from "@/lib/api/authorized-fetch";

export async function getGreeting(
  getToken: () => Promise<null | string>,
  signal?: AbortSignal,
): Promise<GreetingResponse> {
  const response = await authorizedFetch(getToken, "/v1/greeting", signal ? { signal } : {});
  return GreetingResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.greeting),
  );
}
