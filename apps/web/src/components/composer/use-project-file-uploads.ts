"use client";

import type { ProjectSummary } from "@cheatcode/types";
import { useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { ComposerAttachmentStatusState } from "@/components/composer/composer-attachment-status";
import { projectFilesQueryKey, uploadProjectFile } from "@/lib/api/project-files";
import { createProject } from "@/lib/api/project-thread";
import {
  appendProjectFileReference,
  PROJECT_FILE_MAX_BATCH,
  validateProjectFileSelection,
} from "@/lib/input/prompt-attachments";

export interface ProjectFileUploads {
  inputRef: RefObject<HTMLInputElement | null>;
  isUploading: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  openPicker: () => void;
  status: ComposerAttachmentStatusState | null;
}

interface ProjectFileUploadOptions {
  getToken: () => Promise<null | string>;
  latestValueRef: { current: string };
  onChange: (value: string) => void;
  onProjectCreated: (project: ProjectSummary) => void;
  project: ProjectSummary | null;
  value: string;
}

export function useProjectFileUploads(options: ProjectFileUploadOptions): ProjectFileUploads {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const currentProjectRef = useRef(options.project);
  const previousValueRef = useRef(options.value);
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState<ComposerAttachmentStatusState | null>(null);
  currentProjectRef.current = options.project;

  useEffect(() => {
    if (previousValueRef.current.length > 0 && options.value.length === 0 && !isUploading) {
      setStatus(null);
    }
    previousValueRef.current = options.value;
  }, [isUploading, options.value]);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (selected.length === 0) return;
      const files = selected.slice(0, PROJECT_FILE_MAX_BATCH);
      setIsUploading(true);
      const targetProject = await resolveUploadProject(options, files, setStatus, (project) => {
        currentProjectRef.current = project;
        options.onProjectCreated(project);
      });
      if (!targetProject) {
        setIsUploading(false);
        return;
      }
      if (!options.project) {
        await queryClient.invalidateQueries({ queryKey: ["sidebar-projects"] });
      }
      const result = await uploadSequentially(
        options,
        targetProject,
        files,
        setStatus,
        () => currentProjectRef.current?.id === targetProject.id,
      );
      setIsUploading(false);
      await queryClient.invalidateQueries({ queryKey: projectFilesQueryKey(targetProject.id) });
      setFinalStatus(result, selected.length, targetProject, currentProjectRef.current, setStatus);
    },
    [options, queryClient],
  );

  return { inputRef, isUploading, onFileChange, openPicker, status };
}

async function resolveUploadProject(
  options: ProjectFileUploadOptions,
  files: File[],
  setStatus: (status: ComposerAttachmentStatusState) => void,
  onCreated: (project: ProjectSummary) => void,
): Promise<ProjectSummary | null> {
  if (options.project) return options.project;
  const firstAcceptedFile = files.find(isValidProjectFileSelection);
  if (!firstAcceptedFile) {
    setStatus({
      names: [],
      tone: "error",
      text: "None of those files can be uploaded. Choose a supported document, data, code, or image file up to 20 MB.",
    });
    return null;
  }
  setStatus({
    names: [],
    tone: "loading",
    text: "Creating a project for your files…",
  });
  try {
    const project = await createProject(options.getToken, {
      name: uploadProjectName(firstAcceptedFile.name),
    });
    onCreated(project);
    return project;
  } catch (error) {
    setStatus({
      names: [],
      tone: "error",
      text: error instanceof Error ? error.message : "Could not create a project for those files.",
    });
    return null;
  }
}

function isValidProjectFileSelection(file: File): boolean {
  try {
    validateProjectFileSelection(file);
    return true;
  } catch {
    return false;
  }
}

function uploadProjectName(filename: string): string {
  const withoutExtension = filename
    .replace(/\.[^.]+$/, "")
    .trim()
    .replace(/\s+/g, " ");
  return (withoutExtension || "Uploaded files").slice(0, 120);
}

async function uploadSequentially(
  options: ProjectFileUploadOptions,
  project: ProjectSummary,
  files: File[],
  setStatus: (status: ComposerAttachmentStatusState) => void,
  isProjectCurrent: () => boolean,
): Promise<{ errors: string[]; names: string[] }> {
  const names: string[] = [];
  const errors: string[] = [];
  for (const [index, file] of files.entries()) {
    setStatus({
      names,
      tone: "loading",
      text: `Saving ${index + 1} of ${files.length} to ${project.name}…`,
    });
    try {
      validateProjectFileSelection(file);
      const uploaded = await uploadProjectFile(options.getToken, project.id, file);
      names.push(uploaded.file.name);
      if (isProjectCurrent()) {
        const nextValue = appendProjectFileReference(
          options.latestValueRef.current,
          uploaded.file.path,
        );
        options.latestValueRef.current = nextValue;
        options.onChange(nextValue);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Could not save ${file.name}.`);
    }
  }
  return { errors, names };
}

function setFinalStatus(
  result: { errors: string[]; names: string[] },
  selectedCount: number,
  targetProject: ProjectSummary,
  currentProject: ProjectSummary | null,
  setStatus: (status: ComposerAttachmentStatusState) => void,
): void {
  const projectChanged = currentProject?.id !== targetProject.id;
  const omittedCount = Math.max(0, selectedCount - PROJECT_FILE_MAX_BATCH);
  const notices = [
    ...result.errors,
    ...(omittedCount > 0
      ? [`Choose up to ${PROJECT_FILE_MAX_BATCH} files at a time; ${omittedCount} was not saved.`]
      : []),
    ...(projectChanged && result.names.length > 0
      ? [`Saved to ${targetProject.name}. Select that project and use / to reference the files.`]
      : []),
  ];
  const fallback =
    result.names.length === 1
      ? `Saved to ${targetProject.name} · available in every chat`
      : `Saved ${result.names.length} files to ${targetProject.name} · available in every chat`;
  setStatus({
    names: result.names,
    tone: notices.length > 0 ? (result.names.length > 0 ? "warning" : "error") : "ok",
    text: notices.join(" ") || fallback,
  });
}
