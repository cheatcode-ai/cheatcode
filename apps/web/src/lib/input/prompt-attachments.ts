import {
  PROJECT_FILE_MAX_BATCH,
  PROJECT_FILE_MAX_BYTES,
  USER_MESSAGE_MAX_CHARACTERS,
} from "@cheatcode/types";

const PROMPT_ATTACHMENT_EXTENSIONS = [
  ".c",
  ".cpp",
  ".css",
  ".csv",
  ".docx",
  ".gif",
  ".go",
  ".h",
  ".html",
  ".java",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".log",
  ".markdown",
  ".md",
  ".pdf",
  ".png",
  ".pptx",
  ".py",
  ".rb",
  ".rs",
  ".sql",
  ".toml",
  ".ts",
  ".tsv",
  ".tsx",
  ".txt",
  ".webp",
  ".xlsx",
  ".xml",
  ".yaml",
  ".yml",
] as const;
const PROMPT_ATTACHMENT_ACCEPT = PROMPT_ATTACHMENT_EXTENSIONS.join(",");
const PROMPT_ATTACHMENT_EXTENSION_SET = new Set<string>(PROMPT_ATTACHMENT_EXTENSIONS);

export { PROJECT_FILE_MAX_BATCH, PROMPT_ATTACHMENT_ACCEPT };

export function validateProjectFileSelection(file: File): void {
  const displayName = displayFilename(file.name);
  const extensionStart = file.name.lastIndexOf(".");
  const extension =
    extensionStart > 0 ? file.name.slice(extensionStart).normalize("NFC").toLowerCase() : "";
  if (!PROMPT_ATTACHMENT_EXTENSION_SET.has(extension)) {
    throw new Error(`${displayName} is not a supported document, data, code, or image file.`);
  }
  if (file.size === 0) {
    throw new Error(`${displayName} is empty.`);
  }
  if (file.size > PROJECT_FILE_MAX_BYTES) {
    throw new Error(`${displayName} is larger than 20 MB.`);
  }
}

export function appendProjectFileReference(currentValue: string, path: string): string {
  const reference = `/${path}`;
  if (currentValue.split(/\s+/u).includes(reference)) {
    return currentValue;
  }
  const trimmed = currentValue.trimEnd();
  const nextValue = trimmed ? `${trimmed} ${reference} ` : `${reference} `;
  assertUserMessageWithinLimit(nextValue);
  return nextValue;
}

export function assertUserMessageWithinLimit(value: string): void {
  if (value.length <= USER_MESSAGE_MAX_CHARACTERS) {
    return;
  }
  throw new Error(
    `Messages can contain at most ${USER_MESSAGE_MAX_CHARACTERS.toLocaleString()} characters, including selected context.`,
  );
}

function displayFilename(name: string): string {
  return name.normalize("NFC").replaceAll("/", "-").replaceAll("\\", "-").trim() || "That file";
}
