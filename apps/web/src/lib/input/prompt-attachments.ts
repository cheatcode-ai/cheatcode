const MAX_PROMPT_ATTACHMENT_BYTES = 500_000;
const PROMPT_ATTACHMENT_ACCEPT =
  ".csv,.json,.jsonl,.md,.markdown,.txt,.ts,.tsx,.js,.jsx,.py,.sql,.html,.css,.xml,.yaml,.yml,.toml";

export interface PromptAttachment {
  content: string;
  language: string;
  name: string;
  size: number;
}

export { MAX_PROMPT_ATTACHMENT_BYTES, PROMPT_ATTACHMENT_ACCEPT };

export async function readPromptAttachment(file: File): Promise<PromptAttachment> {
  const normalizedName = normalizeFilename(file.name);
  if (!isSupportedPromptFile(file)) {
    throw new Error(`${normalizedName} is not a supported text, code, or data file.`);
  }
  if (file.size > MAX_PROMPT_ATTACHMENT_BYTES) {
    throw new Error(`${normalizedName} is larger than 500 KB.`);
  }
  const content = await file.text();
  if (!content.trim()) {
    throw new Error(`${normalizedName} is empty.`);
  }
  return {
    content,
    language: languageForFilename(normalizedName),
    name: normalizedName,
    size: file.size,
  };
}

export function appendPromptAttachment(currentValue: string, attachment: PromptAttachment): string {
  const header = `Attached file: ${attachment.name} (${formatBytes(attachment.size)})`;
  const fence = attachment.content.includes("```") ? "````" : "```";
  const block = `${header}\n\n${fence}${attachment.language}\n${attachment.content.trim()}\n${fence}`;
  const trimmed = currentValue.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

function isSupportedPromptFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/x-ndjson" ||
    name.endsWith(".jsonl") ||
    name.endsWith(".csv") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".ts") ||
    name.endsWith(".tsx") ||
    name.endsWith(".js") ||
    name.endsWith(".jsx") ||
    name.endsWith(".py") ||
    name.endsWith(".sql") ||
    name.endsWith(".html") ||
    name.endsWith(".css") ||
    name.endsWith(".xml") ||
    name.endsWith(".yaml") ||
    name.endsWith(".yml") ||
    name.endsWith(".toml")
  );
}

function normalizeFilename(name: string): string {
  const normalized = name.normalize("NFC").replaceAll("/", "-").replaceAll("\\", "-").trim();
  return normalized || "attachment.txt";
}

function languageForFilename(name: string): string {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    return "csv";
  }
  if (lowerName.endsWith(".json") || lowerName.endsWith(".jsonl")) {
    return "json";
  }
  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) {
    return "markdown";
  }
  const extension = lowerName.split(".").pop();
  return extension && /^[a-z0-9]+$/.test(extension) ? extension : "text";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KB`;
  }
  return `${(kib / 1024).toFixed(1)} MB`;
}
