"use client";

import { type GeneratedOutputSummary, GeneratedOutputsResponseSchema } from "@cheatcode/types";
import { authorizedFetch } from "@/lib/api/authorized-fetch";

export async function listGeneratedOutputs(
  getToken: () => Promise<null | string>,
): Promise<GeneratedOutputSummary[]> {
  const response = await authorizedFetch(getToken, "/v1/outputs");
  const page = GeneratedOutputsResponseSchema.parse(await response.json());
  return page.outputs;
}
