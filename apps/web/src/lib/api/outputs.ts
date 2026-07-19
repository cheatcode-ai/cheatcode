"use client";

import {
  type OutputDownloadUrlResponse,
  OutputDownloadUrlResponseSchema,
  OutputIdSchema,
} from "@cheatcode/types";
import {
  API_RESPONSE_LIMIT_BYTES,
  authorizedFetch,
  readBoundedJsonResponse,
} from "@/lib/api/authorized-fetch";

export async function createOutputDownloadUrl(
  getToken: () => Promise<null | string>,
  outputId: string,
  signal?: AbortSignal,
): Promise<OutputDownloadUrlResponse> {
  const parsedOutputId = OutputIdSchema.parse(outputId);
  const response = await authorizedFetch(
    getToken,
    `/v1/outputs/${encodeURIComponent(parsedOutputId)}/download-url`,
    { method: "POST", ...(signal ? { signal } : {}) },
  );
  return OutputDownloadUrlResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.metadata),
  );
}
