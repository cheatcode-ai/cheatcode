"use client";

import { type MeResponse, MeResponseSchema, type UpdateMe } from "@cheatcode/types";
import { authorizedFetch } from "@/lib/api/authorized-fetch";

type GetToken = () => Promise<null | string>;

export async function getMe(getToken: GetToken): Promise<MeResponse> {
  const response = await authorizedFetch(getToken, "/v1/me");
  return MeResponseSchema.parse(await response.json());
}

export async function updateMe(getToken: GetToken, patch: UpdateMe): Promise<MeResponse> {
  const response = await authorizedFetch(getToken, "/v1/me", {
    body: JSON.stringify(patch),
    method: "PATCH",
  });
  return MeResponseSchema.parse(await response.json());
}
