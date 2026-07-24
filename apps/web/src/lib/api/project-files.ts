"use client";

import {
  type ProjectFileList,
  ProjectFileListSchema,
  type ProjectFileUploadResponse,
  ProjectFileUploadResponseSchema,
} from "@cheatcode/types";
import {
  API_REQUEST_TIMEOUT_MS,
  API_RESPONSE_LIMIT_BYTES,
  authorizedFetch,
  readBoundedJsonResponse,
} from "@/lib/api/authorized-fetch";

export async function listProjectFiles(
  getToken: () => Promise<null | string>,
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectFileList> {
  const response = await authorizedFetch(
    getToken,
    projectFilesPath(projectId),
    signal ? { signal } : {},
  );
  return ProjectFileListSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.metadata),
  );
}

export async function uploadProjectFile(
  getToken: () => Promise<null | string>,
  projectId: string,
  file: File,
): Promise<ProjectFileUploadResponse> {
  const query = new URLSearchParams({ filename: file.name });
  const response = await authorizedFetch(
    getToken,
    `${projectFilesPath(projectId)}?${query.toString()}`,
    {
      body: file,
      headers: { "Content-Type": "application/octet-stream" },
      method: "POST",
    },
    { timeoutMs: API_REQUEST_TIMEOUT_MS.provisioning },
  );
  return ProjectFileUploadResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.metadata),
  );
}

export function projectFilesQueryKey(projectId: string): readonly ["project-files", string] {
  return ["project-files", projectId] as const;
}

function projectFilesPath(projectId: string): string {
  return `/v1/projects/${encodeURIComponent(projectId)}/files`;
}
