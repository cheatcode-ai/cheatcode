"use client";

import {
  type OutputDownloadUrlResponse,
  OutputDownloadUrlResponseSchema,
  OutputIdSchema,
} from "@cheatcode/types";
import {
  API_RESPONSE_LIMIT_BYTES,
  authorizedFetch,
  readBoundedBlobResponse,
  readBoundedJsonResponse,
} from "@/lib/api/authorized-fetch";

const OUTPUT_IMAGE_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;
const OUTPUT_IMAGE_PREVIEW_TIMEOUT_MS = 30_000;

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

export async function loadOutputImagePreview(
  getToken: () => Promise<null | string>,
  outputId: string,
  sizeBytes: number,
  signal: AbortSignal,
): Promise<Blob> {
  if (sizeBytes <= 0 || sizeBytes > OUTPUT_IMAGE_PREVIEW_MAX_BYTES) {
    throw new Error("This image is too large to preview here. Download it to view the original.");
  }
  const requestSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(OUTPUT_IMAGE_PREVIEW_TIMEOUT_MS),
  ]);
  const capability = await createOutputDownloadUrl(getToken, outputId, requestSignal);
  const response = await fetch(capability.downloadUrl, {
    referrerPolicy: "no-referrer",
    signal: requestSignal,
  });
  if (!response.ok) {
    throw new Error(`Image preview returned HTTP ${response.status}`);
  }
  const blob = await readBoundedBlobResponse(response, sizeBytes);
  if (blob.size === 0 || !blob.type.startsWith("image/")) {
    throw new Error("The generated output is not a displayable image.");
  }
  return blob;
}
