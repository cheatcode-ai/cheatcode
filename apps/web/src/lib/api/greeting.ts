"use client";

import { type GreetingResponse, GreetingResponseSchema } from "@cheatcode/types";
import { authorizedFetch } from "@/lib/api/authorized-fetch";

export async function getGreeting(
  getToken: () => Promise<null | string>,
): Promise<GreetingResponse> {
  const response = await authorizedFetch(getToken, "/v1/greeting");
  return GreetingResponseSchema.parse(await response.json());
}
