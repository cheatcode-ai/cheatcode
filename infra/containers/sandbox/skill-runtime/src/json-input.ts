import { readFile } from "node:fs/promises";

import type { StringOptionDefinition } from "./types";
import { stringOption } from "./tooling";

export function jsonFileOption(
  config: Omit<StringOptionDefinition, "kind">,
): StringOptionDefinition {
  return stringOption({
    ...config,
    description: `${config.description} Provide a path to a JSON file.`,
  });
}

export async function resolveInlineOrFileInput(params: {
  value?: string;
  filePath?: string;
  valueFlag: string;
  fileFlag: string;
}): Promise<string | undefined> {
  if (typeof params.value === "string" && typeof params.filePath === "string") {
    throw new Error(
      `Provide either ${params.valueFlag} or ${params.fileFlag}, not both.`,
    );
  }

  if (typeof params.filePath === "string") {
    return readFile(params.filePath, "utf8");
  }

  return params.value;
}

export async function parseJsonInlineOrFileInput(params: {
  value?: string;
  filePath?: string;
  valueFlag: string;
  fileFlag: string;
}): Promise<unknown | undefined> {
  const resolved = await resolveInlineOrFileInput(params);
  if (typeof resolved === "undefined") {
    return undefined;
  }

  try {
    return JSON.parse(resolved);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown JSON parse error.";
    throw new Error(
      `Invalid JSON from ${params.valueFlag} or ${params.fileFlag}: ${message}`,
    );
  }
}

export async function parseJsonArrayInlineOrFileInput(params: {
  value?: string;
  filePath?: string;
  valueFlag: string;
  fileFlag: string;
}): Promise<unknown[]> {
  const parsed = await parseJsonInlineOrFileInput(params);
  if (typeof parsed === "undefined") {
    return [];
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `${params.valueFlag} or ${params.fileFlag} must be a JSON array.`,
    );
  }

  return parsed;
}

export async function parseJsonObjectInlineOrFileInput(params: {
  value?: string;
  filePath?: string;
  valueFlag: string;
  fileFlag: string;
}): Promise<Record<string, unknown>> {
  const parsed = await parseJsonInlineOrFileInput(params);
  if (typeof parsed === "undefined") {
    return {};
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${params.valueFlag} or ${params.fileFlag} must be a JSON object.`,
    );
  }

  return parsed as Record<string, unknown>;
}
