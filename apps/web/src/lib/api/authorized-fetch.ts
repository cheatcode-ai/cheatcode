"use client";

import { gatewayRequestUrl } from "@cheatcode/api-client";
import { env } from "@cheatcode/env/web";
import { ErrorResponseSchema } from "@cheatcode/types";

export async function authorizedFetch(
  getToken: () => Promise<null | string>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getToken();
  if (!token) {
    throw new Error("Authentication token is unavailable");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(gatewayRequestUrl(env.NEXT_PUBLIC_GATEWAY_URL, path), {
    ...init,
    headers,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response;
}

async function readErrorMessage(response: Response): Promise<string> {
  const parsed = ErrorResponseSchema.safeParse(
    await response
      .clone()
      .json()
      .catch(() => null),
  );
  return parsed.success ? parsed.data.error.message : `Request failed with HTTP ${response.status}`;
}
