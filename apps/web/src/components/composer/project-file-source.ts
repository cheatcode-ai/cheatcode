"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import type { ComposerMenuItem } from "@/components/composer/composer-popover";
import { listProjectFiles, projectFilesQueryKey } from "@/lib/api/project-files";

const MAX_FILE_ITEMS = 30;

/** `/` source for durable files that were uploaded into the selected project. */
export function useProjectFileItems({
  enabled,
  projectId,
  query,
}: {
  enabled: boolean;
  projectId: string | null;
  query: string;
}): ComposerMenuItem[] {
  const { getToken } = useAuth();
  const files = useQuery({
    enabled: enabled && projectId !== null,
    queryFn: ({ signal }) => listProjectFiles(getToken, projectId ?? "", signal),
    queryKey: projectFilesQueryKey(projectId ?? "none"),
    retry: false,
    staleTime: 30_000,
  });
  if (!enabled) return [];
  if (!projectId) return [statusRow("Choose a project to browse its files")];
  if (files.isPending) return [statusRow("Searching project files…")];
  if (files.isError) return [statusRow("Project files are temporarily unavailable")];
  const needle = query.trim().toLocaleLowerCase();
  const matched = files.data.files
    .filter((file) => `${file.name} ${file.path}`.toLocaleLowerCase().includes(needle))
    .slice(0, MAX_FILE_ITEMS);
  if (matched.length === 0) return [statusRow("No matching uploaded files")];
  return matched.map((file) => ({
    hint: file.versionCount > 1 ? `${file.versionCount} versions` : "saved in project",
    id: `project-file:${file.fileId}:${file.versionId}`,
    insert: `/${file.path} `,
    label: file.name,
    visual: "file",
  }));
}

function statusRow(label: string): ComposerMenuItem {
  return {
    disabled: true,
    id: `project-file-status:${label}`,
    insert: "",
    label,
    visual: "status",
  };
}
